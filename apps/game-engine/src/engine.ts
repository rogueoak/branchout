// The game engine: it sequences the generic round lifecycle, holds session state in Redis,
// streams updates over pub/sub, applies host controls, and reports results to the control-plane.
// A game module (resolved from the registry) fills in what each phase means; everything else -
// phase order, timers, persistence, streaming, idempotent reporting - lives here.

import {
  PROTOCOL_VERSION,
  rankStandings,
  type GameCompleteReport,
  type LeaderboardMessage,
  type PromptMessage,
  type RevealMessage,
  type RoundReport,
  type ServerMessage,
  type StartHandoffRequest,
  type StartHandoffResponse,
  type StateMessage,
  type Standing,
  type ScoreEvent,
} from '@branchout/protocol';
import type { ConfigSchema } from '@branchout/game-sdk';
import type { GameModule, RoundContext } from './lifecycle';
import type { GameRegistry } from './registry';
import type { ControlPlaneReporter } from './reporter';
import { realScheduler, type Scheduler } from './scheduler';
import { streamChannel, type PubSub } from './pubsub';
import { sessionKey, type SessionState, type SessionStore } from './session';

/** Host controls applied to a running session. */
export type HostAction = 'pause' | 'advance' | 'restart' | 'exit';

/**
 * Grace period before the engine auto-closes an answer round once every connected player has
 * submitted (feedback 0015). Short enough that a finished table is not left waiting, long enough
 * that a player can still tweak a just-typed answer before the reveal.
 */
export const AUTO_ADVANCE_MS = 2000;

export class NoSessionError extends Error {
  constructor(room: string, game: string) {
    super(`no session for room "${room}" game "${game}"`);
    this.name = 'NoSessionError';
  }
}

export class UnknownPlayerError extends Error {
  constructor(player: string) {
    super(`player "${player}" is not in this session's roster`);
    this.name = 'UnknownPlayerError';
  }
}

export interface EngineDeps {
  registry: GameRegistry;
  store: SessionStore;
  pubsub: PubSub;
  reporter: ControlPlaneReporter;
  scheduler?: Scheduler;
  /** Wall-clock seam for answer-window deadlines; defaults to `Date.now`. Injected for tests. */
  clock?: () => number;
  /** Structured logger seam; defaults to console. */
  logger?: Pick<Console, 'error'>;
  /** Per-game config validators (from each plugin's manifest); run at the start-handoff boundary. */
  configSchemas?: Map<string, ConfigSchema<unknown>>;
}

export class GameEngine {
  private readonly registry: GameRegistry;
  private readonly store: SessionStore;
  private readonly pubsub: PubSub;
  private readonly reporter: ControlPlaneReporter;
  private readonly scheduler: Scheduler;
  private readonly clock: () => number;
  private readonly logger: Pick<Console, 'error'>;
  private readonly configSchemas?: Map<string, ConfigSchema<unknown>>;
  /** Per-session promise chain: serializes reads-modify-writes within this process. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(deps: EngineDeps) {
    this.registry = deps.registry;
    this.store = deps.store;
    this.pubsub = deps.pubsub;
    this.reporter = deps.reporter;
    this.scheduler = deps.scheduler ?? realScheduler;
    this.clock = deps.clock ?? Date.now;
    this.logger = deps.logger ?? console;
    this.configSchemas = deps.configSchemas;
  }

  /** Serialize operations on one session so concurrent frames cannot lose an update. */
  private run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    // Swallow rejections on the chain guard so one failure does not poison the queue.
    const guard = next.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, guard);
    // Prune the key once its chain drains and nothing newer has chained onto it, so the map does
    // not grow unbounded across every room+game the engine ever serves.
    void guard.then(() => {
      if (this.locks.get(key) === guard) this.locks.delete(key);
    });
    return next;
  }

  /** Start (or idempotently rejoin) a session from a control-plane handoff. */
  async start(req: StartHandoffRequest): Promise<StartHandoffResponse> {
    const key = sessionKey(req.room, req.game);
    return this.run(key, async () => {
      const existing = await this.store.load(req.room, req.game);
      // Idempotent while a game is live; a finished (`complete`) session is startable again so
      // 0006 can re-hand-off the same game into a room without the session wedging forever.
      if (existing && existing.phase !== 'complete') {
        return { v: PROTOCOL_VERSION, room: req.room, game: req.game, status: 'running' };
      }
      const module = this.registry.resolve(req.game);
      // Validate the opaque handoff config against the game's manifest schema at the boundary. It
      // throws on invalid config, which app.ts turns into a 400. The game's own configure() still
      // runs below and remains the source of rounds/scratch.
      const schema = this.configSchemas?.get(req.game);
      if (schema) schema(req.config);
      const players = req.players.map((p) => ({
        player: p.player,
        nickname: p.nickname,
        connected: false,
        // Absent flag defaults to false (additive handoff field, spec 0014).
        isHost: p.isHost ?? false,
      }));
      const cfg = module.configure(req.config, players);
      if (!Number.isInteger(cfg.rounds) || cfg.rounds < 1) {
        throw new Error(`game "${req.game}" configured an invalid round count: ${cfg.rounds}`);
      }
      const state: SessionState = {
        room: req.room,
        game: req.game,
        runId: 1,
        phase: 'configuring',
        paused: false,
        hostPaused: false,
        round: 1,
        rounds: cfg.rounds,
        disputeWindowMs: cfg.disputeWindowMs ?? 0,
        answerWindowMs: cfg.answerWindowMs ?? 0,
        players,
        scores: Object.fromEntries(players.map((p) => [p.player, 0])),
        roundScores: [],
        disputes: [],
        scratch: cfg.scratch,
        config: req.config,
        reportedRounds: [],
        pendingRounds: [],
        completeReported: false,
      };
      await this.startRoundInto(state, module);
      await this.store.save(state);
      return { v: PROTOCOL_VERSION, room: req.room, game: req.game, status: 'started' };
    });
  }

  /**
   * Bind a device to a session; mark the player connected and return the catch-up frames the
   * joiner needs to render the current phase. The player must be in the roster the control-plane
   * handed off - a device cannot inject a new player id or take over another player's slot. (This
   * is input validation at the boundary; per-player auth arrives with the control-plane session, a
   * later spec.)
   *
   * Returns the frames a fresh device would have received had it been subscribed all along, in
   * reducer-safe order: the persisted `prompt` (which clears any stale reveal/standings on the
   * client), then `reveal`, then `leaderboard`, then the authoritative `state` last. Without this,
   * a late joiner or reconnecting device would see only a state snapshot and never the question.
   */
  async join(
    room: string,
    game: string,
    player: string,
    nickname: string,
  ): Promise<ServerMessage[]> {
    const key = sessionKey(room, game);
    return this.run(key, async () => {
      const state = await this.requireState(room, game);
      const existing = state.players.find((p) => p.player === player);
      if (!existing) {
        throw new UnknownPlayerError(player);
      }
      existing.connected = true;
      if (nickname) existing.nickname = nickname;
      // A reconnecting host lifts the auto-pause its disconnect set (a deliberate host pause has
      // hostPaused=false and is left alone). Re-arm a timed window as a manual resume would.
      if (existing.isHost && state.hostPaused) {
        state.paused = false;
        state.hostPaused = false;
        const module = this.registry.resolve(state.game);
        if (state.phase === 'disputing' || state.phase === 'voting') {
          this.armWindow(state, module, state.phase);
        } else {
          // Continue the answer countdown from where the host's drop froze it (spec 0017).
          this.resumeAnswerWindow(state, module);
        }
      }
      await this.store.save(state);
      // Others see the (re)connection and any resume; the joiner gets the catch-up frames.
      await this.publish(state, this.stateMessage(state));
      return this.catchUpFrames(state);
    });
  }

  /** The ordered frames that reconstruct the current phase for a joining device (see {@link join}). */
  private catchUpFrames(state: SessionState): ServerMessage[] {
    const frames: ServerMessage[] = [];
    if (state.prompt !== undefined) frames.push(this.promptMessage(state, state.prompt));
    if (state.reveal !== undefined) frames.push(this.revealMessage(state, state.reveal));
    if (state.standings !== undefined) {
      frames.push(this.leaderboardMessage(state, state.standings));
    }
    frames.push(this.stateMessage(state));
    return frames;
  }

  /** Mark a player disconnected (their session state survives for reconnect). */
  async disconnect(room: string, game: string, player: string): Promise<void> {
    const key = sessionKey(room, game);
    await this.run(key, async () => {
      const state = await this.store.load(room, game);
      if (!state) return;
      const existing = state.players.find((p) => p.player === player);
      if (!existing || !existing.connected) return;
      existing.connected = false;
      // The host runs the game (only it advances rounds), so if it drops mid-game the round would
      // strand. Auto-pause and flag it so the host's reconnect - and only that - lifts it. A game
      // already paused (manually or otherwise) or finished is left as-is (spec 0014).
      if (existing.isHost && !state.paused && state.phase !== 'complete') {
        state.paused = true;
        state.hostPaused = true;
        // The auto-pause must also hold the answer countdown, or it keeps ticking (and could
        // force-close the round) while the host is away (spec 0017).
        this.freezeAnswerWindow(state);
      }
      await this.store.save(state);
      await this.publish(state, this.stateMessage(state));
      // A drop can complete the answer round for the players who remain: the leaver was the last
      // one the round was waiting on. Re-check and arm the grace timer, or the round would hang
      // until a host tap (feedback 0015). Skipped when the disconnect paused the game (host drop).
      if (state.phase === 'collecting' && !state.paused) {
        const module = this.registry.resolve(state.game);
        if (module.allAnswered?.(this.context(state))) this.armAutoAdvance(state, module);
      }
    });
  }

  async submitAnswer(
    room: string,
    game: string,
    player: string,
    round: number,
    answer: string,
  ): Promise<void> {
    const key = sessionKey(room, game);
    await this.run(key, async () => {
      const state = await this.store.load(room, game);
      if (!state || state.paused || state.phase !== 'collecting' || state.round !== round) {
        return; // stale or out-of-phase submission: ignore
      }
      const module = this.registry.resolve(state.game);
      const result = module.collectAnswer(this.context(state), player, answer);
      state.scratch = result.scratch;
      await this.store.save(state);
      // Self-heal the answer-window timer: it lives in memory, so an engine restart mid-round leaves
      // the persisted deadline with nothing to fire it. Re-arming on a submit (a duplicate the
      // deadline self-correction neutralizes) makes a live round close on time again after a restart.
      if (state.answerDeadline !== undefined) {
        this.armAnswerWindow(state, module, state.answerDeadline - this.clock());
      }
      if (module.allAnswered?.(this.context(state))) this.armAutoAdvance(state, module);
    });
  }

  async submitVote(
    room: string,
    game: string,
    player: string,
    round: number,
    target: string,
    agree: boolean,
  ): Promise<void> {
    const key = sessionKey(room, game);
    await this.run(key, async () => {
      const state = await this.store.load(room, game);
      const votingPhase = state?.phase === 'disputing' || state?.phase === 'voting';
      if (!state || state.paused || !votingPhase || state.round !== round) {
        return;
      }
      const module = this.registry.resolve(state.game);
      const result = module.collectVote(this.context(state), { player, target, agree });
      state.scratch = result.scratch;
      await this.store.save(state);
    });
  }

  /** Apply a host control to the running session. */
  async control(room: string, game: string, action: HostAction): Promise<void> {
    const key = sessionKey(room, game);
    await this.run(key, async () => {
      const state = await this.requireState(room, game);
      const module = this.registry.resolve(state.game);
      switch (action) {
        case 'pause':
          state.paused = !state.paused;
          // Hold or continue the answer countdown across the pause so it never ticks while stopped
          // and a resume continues from the time left, not a fresh window (spec 0017).
          if (state.paused) this.freezeAnswerWindow(state);
          else this.resumeAnswerWindow(state, module);
          await this.store.save(state);
          await this.publish(state, this.stateMessage(state));
          // Resuming inside a timed dispute/vote window re-arms it, so a paused window does not
          // strand the round waiting for a manual advance.
          if (!state.paused && (state.phase === 'disputing' || state.phase === 'voting')) {
            this.armWindow(state, module, state.phase);
          }
          return;
        case 'advance':
          await this.advanceLocked(state, module);
          return;
        case 'restart':
          await this.restart(state, module);
          return;
        case 'exit':
          await this.exit(state, module);
          return;
      }
    });
  }

  /**
   * Read the current session state (for the inspect route and tests). Serialized behind the
   * session's operation queue, so a read observes every write enqueued before it.
   */
  async getState(room: string, game: string): Promise<SessionState | null> {
    return this.run(sessionKey(room, game), () => this.store.load(room, game));
  }

  /**
   * A protocol `state` projection of the session for external callers (the inspect route). Unlike
   * {@link getState} it exposes only the wire contract - phase, players, scores - never the
   * module's `scratch` or the opaque `config`, which can hold in-flight secrets (e.g. answers).
   */
  async getSnapshot(room: string, game: string): Promise<StateMessage | null> {
    const state = await this.getState(room, game);
    return state ? this.stateMessage(state) : null;
  }

  // --- internals ---

  private async requireState(room: string, game: string): Promise<SessionState> {
    const state = await this.store.load(room, game);
    if (!state) throw new NoSessionError(room, game);
    return state;
  }

  private context(state: SessionState): RoundContext {
    return {
      room: state.room,
      game: state.game,
      phase: state.phase,
      round: state.round,
      players: state.players,
      scores: state.scores,
      scratch: state.scratch,
      config: state.config,
    };
  }

  private applyScores(state: SessionState, events: readonly ScoreEvent[]): void {
    for (const event of events) {
      state.scores[event.player] = (state.scores[event.player] ?? 0) + event.points;
    }
    state.roundScores.push(...events);
  }

  private async startRoundInto(state: SessionState, module: GameModule): Promise<void> {
    const result = module.startRound(this.context(state));
    state.scratch = result.scratch;
    state.phase = 'collecting';
    // Persist the current prompt for join catch-up; a new round clears the prior reveal/standings
    // (mirrors what the `prompt` frame does on the client).
    state.prompt = result.prompt;
    state.reveal = undefined;
    state.standings = undefined;
    // Open the answer window: a fresh deadline the state frame projects as remaining ms, and a
    // timer that force-closes the round if it expires before everyone answers (spec 0017).
    state.answerRemainingMs = undefined;
    state.answerDeadline =
      state.answerWindowMs > 0 ? this.clock() + state.answerWindowMs : undefined;
    await this.publish(state, this.promptMessage(state, result.prompt));
    await this.publish(state, this.stateMessage(state));
    if (state.answerDeadline !== undefined)
      this.armAnswerWindow(state, module, state.answerWindowMs);
  }

  /** One phase transition. Saves once at the end and (re)arms the dispute-window timer. */
  private async advanceLocked(state: SessionState, module: GameModule): Promise<void> {
    if (state.paused) return;
    switch (state.phase) {
      case 'configuring':
        await this.startRoundInto(state, module);
        break;
      case 'collecting': {
        const result = module.reveal(this.context(state));
        state.scratch = result.scratch;
        this.applyScores(state, result.scores);
        state.phase = 'disputing';
        state.reveal = result.reveal;
        // The answer window is over; drop the deadline so the reveal-phase state frame carries no
        // stale countdown.
        state.answerDeadline = undefined;
        state.answerRemainingMs = undefined;
        await this.publish(state, this.revealMessage(state, result.reveal));
        await this.publish(state, this.stateMessage(state));
        this.armWindow(state, module, 'disputing');
        break;
      }
      case 'disputing': {
        const result = module.disputeWindow(this.context(state));
        state.scratch = result.scratch;
        state.disputes = result.disputes;
        if (result.disputes.length === 0) {
          await this.finalizeRound(state, module);
        } else {
          state.phase = 'voting';
          await this.publish(state, this.stateMessage(state));
          this.armWindow(state, module, 'voting');
        }
        break;
      }
      case 'voting': {
        const result = module.disputeVote(this.context(state));
        state.scratch = result.scratch;
        this.applyScores(state, result.scores);
        if (result.reveal !== undefined) {
          state.reveal = result.reveal;
          await this.publish(state, this.revealMessage(state, result.reveal));
        }
        await this.finalizeRound(state, module);
        break;
      }
      case 'leaderboard': {
        const result = module.advance(this.context(state));
        if (result.done || state.round >= state.rounds) {
          await this.endGame(state, module);
        } else {
          state.round += 1;
          state.roundScores = [];
          state.disputes = [];
          await this.startRoundInto(state, module);
        }
        break;
      }
      case 'complete':
        break; // terminal
    }
    await this.store.save(state);
  }

  /** Close out a round: publish the leaderboard and report the round result (idempotent). */
  private async finalizeRound(state: SessionState, module: GameModule): Promise<void> {
    state.phase = 'leaderboard';
    const standings = module.leaderboard(this.context(state));
    state.standings = standings;
    await this.publish(state, this.leaderboardMessage(state, standings));
    await this.publish(state, this.stateMessage(state));

    const roundId = `${state.room}:${state.game}:${state.runId}:${state.round}`;
    const known =
      state.reportedRounds.includes(roundId) ||
      state.pendingRounds.some((r) => r.roundId === roundId);
    if (!known) {
      state.pendingRounds.push({
        v: PROTOCOL_VERSION,
        room: state.room,
        game: state.game,
        round: state.round,
        roundId,
        scores: state.roundScores,
        standings,
      });
    }
    await this.flushPendingRounds(state);
  }

  /**
   * Deliver queued round reports, keeping any that still fail. The `roundId` dedupe guarantees at
   * most one debit per round even across retries: a delivered id lands in `reportedRounds` and is
   * never re-sent.
   */
  private async flushPendingRounds(state: SessionState): Promise<void> {
    const remaining: RoundReport[] = [];
    for (const report of state.pendingRounds) {
      if (state.reportedRounds.includes(report.roundId)) continue;
      const sent = await this.tryReport(() => this.reporter.reportRound(report));
      if (sent) state.reportedRounds.push(report.roundId);
      else remaining.push(report);
    }
    state.pendingRounds = remaining;
  }

  private async endGame(state: SessionState, module: GameModule): Promise<void> {
    state.phase = 'complete';
    const standings = module.endGame(this.context(state));
    state.standings = standings;
    await this.publish(state, this.leaderboardMessage(state, standings));
    await this.publish(state, this.stateMessage(state));
    // Drain any straggler round reports before the completion report.
    await this.flushPendingRounds(state);
    await this.reportComplete(state, standings);
  }

  private async reportComplete(state: SessionState, standings: Standing[]): Promise<void> {
    if (state.completeReported) return;
    const report: GameCompleteReport = {
      v: PROTOCOL_VERSION,
      room: state.room,
      game: state.game,
      gameId: `${state.room}:${state.game}:${state.runId}`,
      standings,
    };
    const sent = await this.tryReport(() => this.reporter.reportComplete(report));
    if (sent) state.completeReported = true;
  }

  private async restart(state: SessionState, module: GameModule): Promise<void> {
    const cfg = module.configure(state.config, state.players);
    state.runId += 1;
    state.round = 1;
    state.rounds = cfg.rounds;
    state.disputeWindowMs = cfg.disputeWindowMs ?? 0;
    state.answerWindowMs = cfg.answerWindowMs ?? 0;
    state.paused = false;
    state.hostPaused = false;
    state.scratch = cfg.scratch;
    state.roundScores = [];
    state.disputes = [];
    state.completeReported = false;
    for (const player of state.players) state.scores[player.player] = 0;
    await this.startRoundInto(state, module);
    await this.store.save(state);
  }

  private async exit(state: SessionState, module: GameModule): Promise<void> {
    // End the game now, report final standings, then drop the session so the room can reset.
    const standings = module.endGame(this.context(state));
    state.phase = 'complete';
    state.standings = standings;
    await this.publish(state, this.leaderboardMessage(state, standings));
    await this.publish(state, this.stateMessage(state));
    await this.reportComplete(state, standings);
    await this.store.delete(state.room, state.game);
  }

  /**
   * Arm the "everyone answered" auto-advance: after {@link AUTO_ADVANCE_MS} close the answer round
   * unless it has already moved on. The fire-time guard re-checks phase/round/pause, so a host who
   * advances first, a pause, or a new round all cancel it harmlessly; re-arming on each late submit
   * is safe because a stale timer finds a changed phase/round and no-ops. Skipped while paused.
   */
  private armAutoAdvance(state: SessionState, module: GameModule): void {
    if (state.paused) return;
    const { room, game, round, runId } = state;
    this.scheduler.schedule(AUTO_ADVANCE_MS, () => {
      void this.run(sessionKey(room, game), async () => {
        const current = await this.store.load(room, game);
        // Fire only if the same run's same round is still collecting and unpaused. The `runId` guard
        // matters because a restart resets `round` to 1 and re-enters `collecting`, so a stale
        // round-1 timer from the prior run must not advance the fresh one.
        if (
          !current ||
          current.paused ||
          current.phase !== 'collecting' ||
          current.round !== round ||
          current.runId !== runId
        ) {
          return;
        }
        await this.advanceLocked(current, module);
      });
    });
  }

  /**
   * Arm the answer-window force-close: after `delayMs` advance `collecting -> reveal` unless the
   * round already moved on. The fire-time guard re-checks phase/round/runId/pause, so an early close
   * (everyone answered), a host advance, a pause, or a new round all cancel it harmlessly. No-op
   * while paused or when there is no timer.
   */
  private armAnswerWindow(state: SessionState, module: GameModule, delayMs: number): void {
    if (state.paused || state.answerWindowMs <= 0) return;
    const { room, game, round, runId } = state;
    this.scheduler.schedule(Math.max(0, delayMs), () => {
      void this.run(sessionKey(room, game), async () => {
        const current = await this.store.load(room, game);
        if (
          !current ||
          current.paused ||
          current.phase !== 'collecting' ||
          current.round !== round ||
          current.runId !== runId ||
          current.answerDeadline === undefined
        ) {
          return;
        }
        // Honor the current deadline, not this timer's original delay: a pause/resume pushes the
        // deadline out, so a timer armed before the pause must re-arm for the time left rather than
        // close the round early. Only when the deadline has truly passed do we advance.
        const remaining = current.answerDeadline - this.clock();
        if (remaining > 0) {
          this.armAnswerWindow(current, module, remaining);
          return;
        }
        await this.advanceLocked(current, module);
      });
    });
  }

  /** Freeze the answer countdown when the game pauses mid-`collecting` so it does not tick away. */
  private freezeAnswerWindow(state: SessionState): void {
    if (state.phase !== 'collecting' || state.answerDeadline === undefined) return;
    state.answerRemainingMs = Math.max(0, state.answerDeadline - this.clock());
    state.answerDeadline = undefined;
  }

  /** Continue a frozen answer countdown from the time left and re-arm the force-close timer. */
  private resumeAnswerWindow(state: SessionState, module: GameModule): void {
    if (state.phase !== 'collecting' || state.paused) return;
    if (state.answerWindowMs > 0) {
      const remaining = state.answerRemainingMs ?? state.answerWindowMs;
      state.answerDeadline = this.clock() + remaining;
      state.answerRemainingMs = undefined;
      this.armAnswerWindow(state, module, remaining);
    }
    // The pause also cancelled the all-answered 2s grace, so if the table had already finished, the
    // round would otherwise wait out the full window on resume. Re-arm it (feedback 0015).
    if (module.allAnswered?.(this.context(state))) this.armAutoAdvance(state, module);
  }

  /** Arm the dispute-window timer; a no-op when the window is manual (0) or paused. */
  private armWindow(state: SessionState, module: GameModule, phase: SessionState['phase']): void {
    if (state.disputeWindowMs <= 0 || state.paused) return;
    const room = state.room;
    const game = state.game;
    this.scheduler.schedule(state.disputeWindowMs, () => {
      void this.run(sessionKey(room, game), async () => {
        const current = await this.store.load(room, game);
        // Only fire if the window is still open on the same phase and not paused.
        if (!current || current.paused || current.phase !== phase) return;
        await this.advanceLocked(current, module);
      });
    });
  }

  private async tryReport(send: () => Promise<void>): Promise<boolean> {
    try {
      await send();
      return true;
    } catch (error) {
      // Stay up if the control-plane is down. A failed round report stays in the outbox and is
      // retried on the next finalize/endGame; the completion report is best-effort (terminal).
      this.logger.error('[game-engine] control-plane report failed', error);
      return false;
    }
  }

  private async publish(state: SessionState, message: ServerMessage): Promise<void> {
    await this.pubsub.publish(streamChannel(state.room, state.game), message);
  }

  private stateMessage(state: SessionState): StateMessage {
    return {
      v: PROTOCOL_VERSION,
      type: 'state',
      room: state.room,
      game: state.game,
      phase: state.phase,
      paused: state.paused,
      round: state.round,
      // Project only the public PlayerView fields; `isHost` is engine-internal (spec 0014).
      players: state.players.map((p) => ({
        player: p.player,
        nickname: p.nickname,
        connected: p.connected,
      })),
      scores: { ...state.scores },
      disputes: [...state.disputes],
      // Project the live time left (or the frozen remaining while paused) so clients anchor a
      // skew-proof countdown; absent when there is no answer timer for this phase. NOTE: this makes
      // the frame time-dependent (`this.clock()`), so two `stateMessage` calls are not byte-equal -
      // intended, since a joiner must see the *current* remaining, and persistence stores the
      // absolute deadline, not this projection.
      answerMsRemaining:
        state.answerDeadline !== undefined
          ? Math.max(0, state.answerDeadline - this.clock())
          : state.answerRemainingMs,
    };
  }

  private promptMessage(state: SessionState, prompt: unknown): PromptMessage {
    return {
      v: PROTOCOL_VERSION,
      type: 'prompt',
      room: state.room,
      game: state.game,
      round: state.round,
      phase: state.phase,
      prompt,
    };
  }

  private revealMessage(state: SessionState, reveal: unknown): RevealMessage {
    return {
      v: PROTOCOL_VERSION,
      type: 'reveal',
      room: state.room,
      game: state.game,
      round: state.round,
      reveal,
    };
  }

  private leaderboardMessage(state: SessionState, standings: Standing[]): LeaderboardMessage {
    return {
      v: PROTOCOL_VERSION,
      type: 'leaderboard',
      room: state.room,
      game: state.game,
      standings,
    };
  }
}

/** Re-export so callers can rank standings the same way the default modules do. */
export { rankStandings };
