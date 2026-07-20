// The game engine: it sequences the generic round lifecycle, holds session state in Redis,
// streams updates over pub/sub, applies host controls, and reports results to the control-plane.
// A game module (resolved from the registry) fills in what each phase means; everything else -
// phase order, timers, persistence, streaming, idempotent reporting - lives here.

import {
  PROTOCOL_VERSION,
  rankStandings,
  type MoveRejectedMessage,
  type GameCompleteReport,
  type LeaderboardMessage,
  type PrivateMessage,
  type PromptMessage,
  type RevealMessage,
  type RoundReport,
  type ServerMessage,
  type SimMessage,
  type StartHandoffRequest,
  type StartHandoffResponse,
  type StateMessage,
  type Standing,
  type ScoreEvent,
} from '@branchout/protocol';
import type { ConfigSchema } from '@branchout/game-sdk';
import type { RoundContext } from './lifecycle';
import type { ControlPlaneReporter } from './reporter';
import { realScheduler, type Scheduler } from './scheduler';
import { privateChannel, streamChannel, type PubSub } from './pubsub';
import { sessionKey, type SessionState, type SessionStore } from './session';
import { UnknownGameError } from './registry';
import type { GameRuntimeProvider, SessionRuntime } from './worker/runtime';

/** Host controls applied to a running session. */
export type HostAction = 'pause' | 'advance' | 'restart' | 'exit';

/**
 * Grace period before the engine auto-closes an answer round once every connected player has
 * submitted (feedback 0015). Short enough that a finished table is not left waiting, long enough
 * that a player can still tweak a just-typed answer before the reveal.
 */
export const AUTO_ADVANCE_MS = 2000;

/**
 * The per-session sim-loop cadence for a live game (spec 0044): 40ms = 25 fps. The engine steps the
 * module's world on this interval and streams the returned `sim` frame, so a precarious tower sways
 * in real time. Turn-based games have no tick and never start this loop.
 */
export const TICK_MS = 40;

/**
 * Consecutive failed sim ticks (a crashed/hung worker that was killed) before the engine stops the
 * loop for that session instead of respawning forever (spec 0045). A single transient crash recovers
 * on the next tick (the counter resets on any success); only a persistently wedged worker trips this,
 * halting the kill/respawn/rebuild thrash. A host pause/resume or reconnect re-arms the loop.
 */
export const MAX_SIM_TICK_FAILURES = 5;

export class NoSessionError extends Error {
  constructor(room: string, game: string) {
    super(`no session for room "${room}" game "${game}"`);
    this.name = 'NoSessionError';
  }
}

export interface EngineDeps {
  /** Supplies each session's game runtime (a worker in production, in-process in tests), spec 0045. */
  runtimeProvider: GameRuntimeProvider;
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
  private readonly runtimeProvider: GameRuntimeProvider;
  private readonly store: SessionStore;
  private readonly pubsub: PubSub;
  private readonly reporter: ControlPlaneReporter;
  private readonly scheduler: Scheduler;
  private readonly clock: () => number;
  private readonly logger: Pick<Console, 'error'>;
  private readonly configSchemas?: Map<string, ConfigSchema<unknown>>;
  /** Per-session promise chain: serializes reads-modify-writes within this process. */
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Per-session sim-loop interval handles for live games (spec 0044); absent when not looping. */
  private readonly simTimers = new Map<string, NodeJS.Timeout>();
  /** Sessions with a sim tick in flight, so the interval drops a frame rather than queuing it (0045). */
  private readonly simTicking = new Set<string>();
  /** Consecutive failed sim ticks per session, to stop the loop after {@link MAX_SIM_TICK_FAILURES}. */
  private readonly simFailures = new Map<string, number>();
  /** The most recent `sim` payload per session, so a joiner catches up to the live world at once. */
  private readonly lastSim = new Map<string, unknown>();
  /**
   * Cancel handle for each session's current dispute/voting/guess/leaderboard window timer (spec
   * 0068). A superseding arm - a phase transition, a resume, a re-base - cancels the prior one, so a
   * stale timer from an earlier phase/round/run can never fire against a later one.
   */
  private readonly windowTimers = new Map<string, () => void>();

  constructor(deps: EngineDeps) {
    this.runtimeProvider = deps.runtimeProvider;
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

  /**
   * The session's game runtime (spec 0045): the async facade over its worker-hosted module. Cheap to
   * fetch repeatedly - once a session's worker is up, this resolves from cached capabilities without a
   * round-trip. Always called inside `run()`, so a session's calls stay serialized.
   */
  private runtimeFor(state: SessionState): Promise<SessionRuntime> {
    // Backfill a seed for a session persisted before spec 0045 (its `seed` is absent). The mutation
    // is picked up by the next store.save; the shipped games never re-run `configure` on a resume, so
    // this only matters for a future game that draws from rng after start.
    if (typeof state.seed !== 'number') state.seed = this.newSeed();
    return this.runtimeProvider.runtime(sessionKey(state.room, state.game), state.game, state.seed);
  }

  /** A fresh base seed for a session's worker rng, so a rebuilt worker replays the same procedural
   * content (Teeter's piece stream); the physics world resumes from the persisted scratch (spec 0045). */
  private newSeed(): number {
    return Math.floor(Math.random() * 0x7fffffff);
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
      // Reject an unknown game id here, before spawning a worker that would only fail to build (spec
      // 0045) - a clean UnknownGameError (400) instead of a wasted spawn + opaque init error. Skipped
      // when no manifests were injected (unit tests wire the runtime directly).
      if (this.configSchemas && !this.configSchemas.has(req.game)) {
        throw new UnknownGameError(req.game);
      }
      // Validate the opaque handoff config against the game's manifest schema at the boundary. It
      // throws on invalid config, which app.ts turns into a 400. The game's own configure() still
      // runs below and remains the source of rounds/scratch.
      const schema = this.configSchemas?.get(req.game);
      if (schema) schema(req.config);
      // Spin up (or reuse) this session's worker and build its module; a fresh seed makes a later
      // respawn rebuild deterministically. A finished session's worker was disposed, so this is new.
      const seed = existing?.seed ?? this.newSeed();
      const runtime = await this.runtimeProvider.runtime(key, req.game, seed);
      const players = req.players.map((p) => ({
        player: p.player,
        nickname: p.nickname,
        connected: false,
        // Absent flag defaults to false (additive handoff field, spec 0014).
        isHost: p.isHost ?? false,
      }));
      const cfg = await runtime.configure(req.config, players);
      if (!Number.isInteger(cfg.rounds) || cfg.rounds < 1) {
        throw new Error(`game "${req.game}" configured an invalid round count: ${cfg.rounds}`);
      }
      const state: SessionState = {
        room: req.room,
        game: req.game,
        runId: 1,
        seed,
        phase: 'configuring',
        paused: false,
        hostPaused: false,
        round: 1,
        rounds: cfg.rounds,
        disputeWindowMs: cfg.disputeWindowMs ?? 0,
        decisionWindowMs: 0,
        moveWindowMs: cfg.moveWindowMs ?? 0,
        leaderboardWindowMs: cfg.leaderboardWindowMs ?? 0,
        autoAdvance: cfg.autoAdvance,
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
      await this.startRoundInto(state, runtime);
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
        // A device authenticated for a playerId that is NOT in the playing roster is a VIEWER
        // (spec 0050): viewers watch a shared screen but never fill the roster or count toward
        // limits. It still needs the BROADCAST stream to render the game, so admit it as a
        // stream-only spectator: hand back the same broadcast catch-up frames a player gets, but
        // make NO roster change (no `connected` flip, no state re-publish) and deal it NO secret.
        // Its per-player private channel is keyed by its own viewer playerId, for which nothing is
        // ever published, so per-player secrecy (spec 0064) holds - a viewer sees only the shared,
        // non-secret broadcast. The join token still proved the control-plane vouched for THIS id,
        // so a device cannot claim a victim's id to read their private stream.
        return this.spectatorCatchUpFrames(state);
      }
      existing.connected = true;
      if (nickname) existing.nickname = nickname;
      // A reconnecting host lifts the auto-pause its disconnect set (a deliberate host pause has
      // hostPaused=false and is left alone). Re-arm a timed window as a manual resume would.
      if (existing.isHost && state.hostPaused) {
        state.paused = false;
        state.hostPaused = false;
        const runtime = await this.runtimeFor(state);
        if (state.phase === 'guessing') {
          await this.resumeDecisionWindow(state, runtime);
        } else if (
          state.phase === 'disputing' ||
          state.phase === 'voting' ||
          state.phase === 'leaderboard'
        ) {
          // Continue the window from where the host's drop froze it (spec 0068); `leaderboard`
          // re-arms its dwell on host reconnect too.
          this.resumeWindow(state, state.phase);
        } else {
          // Continue the answer countdown from where the host's drop froze it (spec 0017).
          await this.resumeMoveWindow(state, runtime);
          // Restart a live game's world where the host disconnect froze it (spec 0044).
          this.startSimLoop(state, runtime);
        }
      }
      await this.store.save(state);
      // Others see the (re)connection and any resume; the joiner gets the catch-up frames.
      await this.publish(state, this.stateMessage(state));
      return this.catchUpFrames(state, player);
    });
  }

  /**
   * The ordered frames that reconstruct the current phase for a joining device (see {@link join}).
   * These are returned to the socket and sent to the joining connection alone, so appending THIS
   * player's stored private payload (spec 0052) restores its secret on reconnect without ever
   * exposing it to another device - the frame never touches the broadcast channel.
   */
  private catchUpFrames(state: SessionState, player: string): ServerMessage[] {
    const frames: ServerMessage[] = [];
    if (state.prompt !== undefined) frames.push(this.promptMessage(state, state.prompt));
    if (state.reveal !== undefined) frames.push(this.revealMessage(state, state.reveal));
    if (state.standings !== undefined) {
      frames.push(this.leaderboardMessage(state, state.standings));
    }
    // For a live game (spec 0044), append the newest streamed `sim` so a joiner renders the live,
    // in-motion tower immediately - the prompt is only the round's opening snapshot, and pub/sub
    // carries later frames only to devices already subscribed.
    const sim = this.lastSim.get(sessionKey(state.room, state.game));
    if (sim != null) frames.push(this.simMessage(state, sim));
    frames.push(this.stateMessage(state));
    // Restore the joining player's OWN private payload (spec 0052), if this round dealt them one. It
    // is keyed by playerId, so only this device's secret is ever looked up - never another player's.
    const secret = state.privatePayloads?.[player];
    if (secret !== undefined) frames.push(this.privateMessage(state, player, secret));
    return frames;
  }

  /**
   * The catch-up frames for a VIEWER (spec 0050): the same broadcast frames a player gets to render
   * the current phase - prompt, reveal, leaderboard, the newest live `sim`, then the authoritative
   * `state` - but NEVER a private payload. A viewer is not a roster player, so it holds no secret; a
   * shared-screen watcher must only ever see the broadcast, keeping the spec-0064 per-player secrecy
   * guarantee intact.
   */
  private spectatorCatchUpFrames(state: SessionState): ServerMessage[] {
    const frames: ServerMessage[] = [];
    if (state.prompt !== undefined) frames.push(this.promptMessage(state, state.prompt));
    if (state.reveal !== undefined) frames.push(this.revealMessage(state, state.reveal));
    if (state.standings !== undefined) {
      frames.push(this.leaderboardMessage(state, state.standings));
    }
    const sim = this.lastSim.get(sessionKey(state.room, state.game));
    if (sim != null) frames.push(this.simMessage(state, sim));
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
        // force-close the round) while the host is away (spec 0017), and freeze any dispute/voting/
        // guess/leaderboard window the same way (spec 0068) so it does not force-advance while away.
        this.freezeMoveWindow(state);
        this.freezeWindow(state);
        // A live game's world freezes while the host is away, mirroring the host pause (spec 0044).
        this.stopSimLoop(sessionKey(state.room, state.game));
      }
      await this.store.save(state);
      await this.publish(state, this.stateMessage(state));
      // A drop can complete the answer round for the players who remain: the leaver was the last
      // one the round was waiting on. Re-check and arm the grace timer, or the round would hang
      // until a host tap (feedback 0015). Skipped when the disconnect paused the game (host drop).
      if (state.phase === 'collecting' && !state.paused) {
        const runtime = await this.runtimeFor(state);
        if (await runtime.allSubmitted(this.context(state))) this.armAutoAdvance(state);
      }
    });
  }

  /**
   * Record a player's move. Returns a targeted `move_rejected` frame when the module refuses the
   * submission (e.g. a duplicate or the correct answer in a bluffing game) so the socket can reply to
   * that one device; a rejected submission writes no scratch and is never broadcast. Returns an empty
   * object otherwise (including a stale/out-of-phase submission, which is silently ignored).
   */
  async submitMove(
    room: string,
    game: string,
    player: string,
    round: number,
    move: string,
  ): Promise<{ reject?: MoveRejectedMessage }> {
    const key = sessionKey(room, game);
    return this.run(key, async () => {
      const state = await this.store.load(room, game);
      if (!state || state.paused || state.phase !== 'collecting' || state.round !== round) {
        return {}; // stale or out-of-phase submission: ignore
      }
      const runtime = await this.runtimeFor(state);
      const result = await runtime.collectMove(this.context(state), player, move);
      // A rejected submission is refused wholesale: no scratch write, no timer re-arm, no broadcast -
      // just a private reply to the sender. The round state is exactly as it was before the attempt.
      if (result.rejected) {
        return { reject: this.moveRejectedMessage(state, result.rejected.reason) };
      }
      state.scratch = result.scratch;
      // Refresh the live "x of y answered" count from the module so the broadcast below carries the
      // new numerator (spec 0069). Undefined for a game that does not report it - the field then
      // stays absent on the wire.
      state.answered = await runtime.answeredCount(this.context(state));
      await this.store.save(state);
      // Self-heal the answer-window timer: it lives in memory, so an engine restart mid-round leaves
      // the persisted deadline with nothing to fire it. Re-arming on a submit (a duplicate the
      // deadline self-correction neutralizes) makes a live round close on time again after a restart.
      if (state.moveDeadline !== undefined) {
        this.armMoveWindow(state, state.moveDeadline - this.clock());
      }
      // Push the refreshed count to every device so the answered indicator updates live as answers
      // land (spec 0069). Only for a game that reports a count (Trivia) - others keep their prior,
      // quieter behaviour (no per-move broadcast) since the field would be absent anyway.
      if (state.answered !== undefined) {
        await this.publish(state, this.stateMessage(state));
      }
      if (await runtime.allSubmitted(this.context(state))) this.armAutoAdvance(state);
      return {};
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
      const votingPhase =
        state?.phase === 'disputing' || state?.phase === 'voting' || state?.phase === 'guessing';
      if (!state || state.paused || !votingPhase || state.round !== round) {
        return;
      }
      const runtime = await this.runtimeFor(state);
      const result = await runtime.collectVote(this.context(state), { player, target, agree });
      state.scratch = result.scratch;
      await this.store.save(state);
      // A guess round auto-closes once every connected player has guessed, mirroring the all-answered
      // early close of the collecting phase (spec 0020).
      if (state.phase === 'guessing' && (await runtime.allDecided(this.context(state)))) {
        this.armAutoAdvance(state, 'guessing');
      }
    });
  }

  /** Apply a host control to the running session. */
  async control(room: string, game: string, action: HostAction): Promise<void> {
    const key = sessionKey(room, game);
    await this.run(key, async () => {
      const state = await this.requireState(room, game);
      const runtime = await this.runtimeFor(state);
      switch (action) {
        case 'pause':
          state.paused = !state.paused;
          // Hold or continue the answer countdown across the pause so it never ticks while stopped
          // and a resume continues from the time left, not a fresh window (spec 0017).
          if (state.paused) this.freezeMoveWindow(state);
          else await this.resumeMoveWindow(state, runtime);
          // Freeze the dispute/voting/guess/leaderboard window the same way (spec 0068): cancel it on
          // pause so a stale timer cannot fire on resume, and stash the time left. Re-armed below.
          if (state.paused) this.freezeWindow(state);
          // A live game's world freezes on pause and resumes on unpause (spec 0044): stop/start the
          // sim loop in the exact spots the move window is frozen/resumed.
          if (state.paused) this.stopSimLoop(sessionKey(state.room, state.game));
          else this.startSimLoop(state, runtime);
          await this.store.save(state);
          await this.publish(state, this.stateMessage(state));
          // Resuming inside a timed dispute/vote/guess/leaderboard window re-arms it from the time
          // left, so a paused window does not strand the round waiting for a manual advance.
          if (!state.paused && state.phase === 'guessing') {
            await this.resumeDecisionWindow(state, runtime);
          } else if (
            !state.paused &&
            (state.phase === 'disputing' ||
              state.phase === 'voting' ||
              state.phase === 'leaderboard')
          ) {
            // `leaderboard` re-arms its dwell too (spec 0068); a no-op when the window is 0.
            this.resumeWindow(state, state.phase);
          }
          return;
        case 'advance':
          await this.advanceLocked(state, runtime);
          return;
        case 'restart':
          await this.restart(state, runtime);
          return;
        case 'exit':
          await this.exit(state, runtime);
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

  private async startRoundInto(state: SessionState, runtime: SessionRuntime): Promise<void> {
    const result = await runtime.startRound(this.context(state));
    state.scratch = result.scratch;
    state.phase = 'collecting';
    // Persist the current prompt for join catch-up; a new round clears the prior reveal/standings
    // (mirrors what the `prompt` frame does on the client).
    state.prompt = result.prompt;
    state.reveal = undefined;
    state.standings = undefined;
    // Clear the prior round's per-player secrets before this round deals its own (spec 0052), so a
    // stale payload never leaks into a later round - the same per-round pruning `reveal`/`standings`
    // get above. `deliverPrivate` below repopulates it from this round's `startRound.private`.
    state.privatePayloads = {};
    // A live game (spec 0044) sits in `collecting` and never opens a move window or auto-advances -
    // the sim loop drives streaming and game end. A turn-based game opens its answer window as usual.
    const live = runtime.live;
    // The prior round's leaderboard window (if any) is done; clear its deadline so the fresh round
    // never inherits a stale one, and drop any lingering timer handle.
    this.windowTimers.get(sessionKey(state.room, state.game))?.();
    this.windowTimers.delete(sessionKey(state.room, state.game));
    state.windowDeadline = undefined;
    state.windowRemainingMs = undefined;
    state.moveRemainingMs = undefined;
    // A fresh round starts with nobody answered yet (spec 0069); the live count grows on each move.
    // Undefined for a game that does not report a count, which keeps the field off its `state` frame.
    state.answered = await runtime.answeredCount(this.context(state));
    state.moveDeadline =
      !live && state.moveWindowMs > 0 ? this.clock() + state.moveWindowMs : undefined;
    await this.publish(state, this.promptMessage(state, result.prompt));
    await this.publish(state, this.stateMessage(state));
    // Deal-time secrets (spec 0052): hand each player their own private payload, targeted, after the
    // public prompt/state so a device already has the round context when its secret arrives.
    await this.deliverPrivate(state, result.private);
    if (state.moveDeadline !== undefined) this.armMoveWindow(state, state.moveWindowMs);
    // Start (or self-heal) the per-session sim loop for a live game once the round is open.
    if (live) this.startSimLoop(state, runtime);
  }

  /** One phase transition. Saves once at the end and (re)arms the dispute-window timer. */
  private async advanceLocked(state: SessionState, runtime: SessionRuntime): Promise<void> {
    if (state.paused) return;
    // A live game (spec 0044) has no reveal/dispute/leaderboard cycle - the sim loop drives it and
    // ends it via tick.over. A host `advance` must never push it into `reveal`; treat it as "end now".
    if (runtime.live && state.phase === 'collecting') {
      await this.endGame(state, runtime);
      await this.store.save(state);
      return;
    }
    switch (state.phase) {
      case 'configuring':
        await this.startRoundInto(state, runtime);
        break;
      case 'collecting': {
        const result = await runtime.reveal(this.context(state));
        state.scratch = result.scratch;
        this.applyScores(state, result.scores);
        state.reveal = result.reveal;
        // The answer window is over; drop the deadline so the reveal-phase state frame carries no
        // stale countdown.
        state.moveDeadline = undefined;
        state.moveRemainingMs = undefined;
        if (result.decision) {
          // A guess game (spec 0020): stream the options and open a guess window instead of the
          // dispute path. Trivia and every dispute game omit `decision` and fall through below.
          // Fail fast at the declaration site: a game that opens a guess phase must resolve it, or
          // the `guessing` case would throw a bare TypeError inside the scheduler after streaming.
          if (!runtime.hasResolveDecision) {
            throw new Error(
              `game "${state.game}" returned a decision phase but implements no resolveDecision`,
            );
          }
          state.phase = 'guessing';
          state.decisionWindowMs = result.decision.windowMs ?? 0;
          // Arm before publishing so the entering frame carries the live window deadline, not a
          // stale one (spec 0069) - mirrors the move-window path and finalizeRound.
          this.armWindow(state, 'guessing');
          await this.publish(state, this.revealMessage(state, result.reveal));
          await this.publish(state, this.stateMessage(state));
        } else {
          state.phase = 'disputing';
          // Arm before publishing so the entering reveal frame carries the live dwell deadline (the
          // "continuing in x"), not the just-elapsed answer window's stale one (spec 0069).
          this.armWindow(state, 'disputing');
          await this.publish(state, this.revealMessage(state, result.reveal));
          await this.publish(state, this.stateMessage(state));
        }
        // A reveal may disclose a secret differently per player (spec 0052); deliver it targeted
        // after the public reveal, on whichever post-reveal path the game took.
        await this.deliverPrivate(state, result.private);
        break;
      }
      case 'disputing': {
        const result = await runtime.disputeWindow(this.context(state));
        state.scratch = result.scratch;
        state.disputes = result.disputes;
        if (result.disputes.length === 0) {
          await this.finalizeRound(state, runtime);
        } else {
          state.phase = 'voting';
          // Arm before publishing so the entering frame carries the live window deadline (spec 0069).
          this.armWindow(state, 'voting');
          await this.publish(state, this.stateMessage(state));
        }
        break;
      }
      case 'voting': {
        const result = await runtime.disputeVote(this.context(state));
        state.scratch = result.scratch;
        this.applyScores(state, result.scores);
        if (result.reveal !== undefined) {
          state.reveal = result.reveal;
          await this.publish(state, this.revealMessage(state, result.reveal));
        }
        await this.finalizeRound(state, runtime);
        break;
      }
      case 'guessing': {
        // The guess window closed (all-decided or the timer): score the guesses and finalize. A game
        // that reaches this phase declared a `decision` at reveal, so it implements resolveDecision.
        const result = await runtime.resolveDecision(this.context(state));
        state.scratch = result.scratch;
        this.applyScores(state, result.scores);
        if (result.reveal !== undefined) {
          state.reveal = result.reveal;
          await this.publish(state, this.revealMessage(state, result.reveal));
        }
        await this.finalizeRound(state, runtime);
        break;
      }
      case 'leaderboard': {
        const result = await runtime.advance(this.context(state));
        if (result.done || state.round >= state.rounds) {
          await this.endGame(state, runtime);
        } else {
          state.round += 1;
          state.roundScores = [];
          state.disputes = [];
          await this.startRoundInto(state, runtime);
        }
        break;
      }
      case 'complete':
        break; // terminal
    }
    await this.store.save(state);
  }

  /** Close out a round: publish the leaderboard and report the round result (idempotent). */
  private async finalizeRound(state: SessionState, runtime: SessionRuntime): Promise<void> {
    state.phase = 'leaderboard';
    const standings = await runtime.leaderboard(this.context(state));
    state.standings = standings;
    // Arm the auto-advance dwell BEFORE publishing the entering `state` frame (spec 0069): the frame
    // projects `autoAdvanceMsRemaining` from `windowDeadline`, so arming after would ship a stale
    // (~0) deadline to every device present at the transition and the "next round in x" countdown
    // would never render until a reconnect. A no-op when `leaderboardWindowMs` is 0 (auto-advance
    // off / a game with no dwell), so the leaderboard then waits on the host exactly as before. The
    // scheduled timer only fires after the dwell (>=1s), long after these awaited publishes.
    this.armWindow(state, 'leaderboard');
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

  private async endGame(state: SessionState, runtime: SessionRuntime): Promise<void> {
    // A live game's sim loop must stop before the game ends (spec 0044); clear its cached frame too,
    // and let the module release its in-process world (endGame path, spec 0044) so it does not leak.
    const key = sessionKey(state.room, state.game);
    this.stopSimLoop(key);
    this.lastSim.delete(key);
    await runtime.disposeLive(this.context(state));
    state.phase = 'complete';
    const standings = await runtime.endGame(this.context(state));
    state.standings = standings;
    await this.publish(state, this.leaderboardMessage(state, standings));
    await this.publish(state, this.stateMessage(state));
    // Drain any straggler round reports before the completion report.
    await this.flushPendingRounds(state);
    await this.reportComplete(state, standings);
    // The game is over; tear down its worker so the thread + its in-process world are freed (spec 0045).
    await this.runtimeProvider.dispose(key);
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

  private async restart(state: SessionState, runtime: SessionRuntime): Promise<void> {
    // Stop any live sim loop and clear its cached frame; startRoundInto restarts a fresh one below.
    const key = sessionKey(state.room, state.game);
    this.stopSimLoop(key);
    this.lastSim.delete(key);
    // A restart is a brand new game: tear down the old worker entirely (freeing its in-process world,
    // spec 0045) and rebuild in a fresh worker with a new seed, so nothing of the old tower/score
    // survives. `runtime` was the old worker's; the fresh one below drives the rest of the restart.
    await runtime.disposeLive(this.context(state));
    await this.runtimeProvider.dispose(key);
    state.seed = this.newSeed();
    const fresh = await this.runtimeProvider.runtime(key, state.game, state.seed);
    const cfg = await fresh.configure(state.config, state.players);
    state.runId += 1;
    state.round = 1;
    state.rounds = cfg.rounds;
    state.disputeWindowMs = cfg.disputeWindowMs ?? 0;
    state.decisionWindowMs = 0;
    state.moveWindowMs = cfg.moveWindowMs ?? 0;
    state.leaderboardWindowMs = cfg.leaderboardWindowMs ?? 0;
    state.autoAdvance = cfg.autoAdvance;
    state.paused = false;
    state.hostPaused = false;
    state.scratch = cfg.scratch;
    state.roundScores = [];
    state.disputes = [];
    state.completeReported = false;
    for (const player of state.players) state.scores[player.player] = 0;
    await this.startRoundInto(state, fresh);
    await this.store.save(state);
  }

  private async exit(state: SessionState, runtime: SessionRuntime): Promise<void> {
    // Stop a live game's sim loop, drop its cached frame, and release its in-process world before
    // ending (spec 0044) so the host-exit path does not leak the world.
    const key = sessionKey(state.room, state.game);
    this.stopSimLoop(key);
    this.lastSim.delete(key);
    await runtime.disposeLive(this.context(state));
    // End the game now, report final standings, then drop the session so the room can reset.
    const standings = await runtime.endGame(this.context(state));
    state.phase = 'complete';
    state.standings = standings;
    await this.publish(state, this.leaderboardMessage(state, standings));
    await this.publish(state, this.stateMessage(state));
    await this.reportComplete(state, standings);
    await this.store.delete(state.room, state.game);
    // The session is gone; tear down its worker so the thread is freed (spec 0045).
    await this.runtimeProvider.dispose(key);
  }

  /**
   * Arm the "everyone answered" auto-advance: after {@link AUTO_ADVANCE_MS} close the answer round
   * unless it has already moved on. The fire-time guard re-checks phase/round/pause, so a host who
   * advances first, a pause, or a new round all cancel it harmlessly; re-arming on each late submit
   * is safe because a stale timer finds a changed phase/round and no-ops. Skipped while paused.
   */
  private armAutoAdvance(state: SessionState, phase: SessionState['phase'] = 'collecting'): void {
    if (state.paused) return;
    const { room, game, round, runId } = state;
    this.scheduler.schedule(AUTO_ADVANCE_MS, () => {
      void this.run(sessionKey(room, game), async () => {
        const current = await this.store.load(room, game);
        // Fire only if the same run's same round is still in the phase we armed for and unpaused. The
        // `runId` guard matters because a restart resets `round` to 1 and re-enters `collecting`, so a
        // stale round-1 timer from the prior run must not advance the fresh one. `phase` lets the
        // guess phase reuse this all-acted early close (spec 0020).
        if (
          !current ||
          current.paused ||
          current.phase !== phase ||
          current.round !== round ||
          current.runId !== runId
        ) {
          return;
        }
        await this.advanceLocked(current, await this.runtimeFor(current));
      });
    });
  }

  /**
   * Arm the answer-window force-close: after `delayMs` advance `collecting -> reveal` unless the
   * round already moved on. The fire-time guard re-checks phase/round/runId/pause, so an early close
   * (everyone answered), a host advance, a pause, or a new round all cancel it harmlessly. No-op
   * while paused or when there is no timer.
   */
  private armMoveWindow(state: SessionState, delayMs: number): void {
    if (state.paused || state.moveWindowMs <= 0) return;
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
          current.moveDeadline === undefined
        ) {
          return;
        }
        // Honor the current deadline, not this timer's original delay: a pause/resume pushes the
        // deadline out, so a timer armed before the pause must re-arm for the time left rather than
        // close the round early. Only when the deadline has truly passed do we advance.
        const remaining = current.moveDeadline - this.clock();
        if (remaining > 0) {
          this.armMoveWindow(current, remaining);
          return;
        }
        await this.advanceLocked(current, await this.runtimeFor(current));
      });
    });
  }

  /**
   * Start the per-session sim loop for a live game (spec 0044): a 40ms interval that steps the
   * module's world and streams the returned `sim`. Idempotent - a no-op if the module is not live or
   * a timer already runs for this session. Each tick reloads the latest state (so a pause/exit that
   * lands between ticks is honored), steps the world, persists the snapshot, publishes the `sim`, and
   * ends the game when `tick` reports `over`. The interval is `unref`d so a pending timer never keeps
   * the process alive on its own.
   */
  private startSimLoop(state: SessionState, runtime: SessionRuntime): void {
    if (!runtime.live) return;
    const key = sessionKey(state.room, state.game);
    if (this.simTimers.has(key)) return;
    const { room, game } = state;
    const timer = setInterval(() => {
      // Drop this frame if the prior tick is still in flight (a slow/hung worker) rather than queuing
      // it behind - a fixed-cadence sim skips frames, it must not accumulate a backlog (spec 0045).
      if (this.simTicking.has(key)) return;
      this.simTicking.add(key);
      void this.run(key, async () => {
        // A timer can outlive the state it was armed for; bail on anything but a running live round.
        if (!this.simTimers.has(key)) return;
        const current = await this.store.load(room, game);
        if (!current || current.paused || current.phase === 'complete') return;
        // The tick runs in the session's worker (spec 0045) - the physics compute stays off the main
        // event loop; the timer + streaming stay here. A crashed/hung worker rejects (handled below),
        // so a bad tick is skipped and the next tick respawns + rebuilds the world.
        const result = await runtime.tick(this.context(current));
        this.simFailures.delete(key); // a good tick clears the consecutive-failure count
        current.scratch = result.scratch;
        this.lastSim.set(key, result.sim);
        // A live game whose secret can change re-emits it here (spec 0052). Persist the update into
        // `privatePayloads` ALWAYS - even on an idle tick with zero connected devices - mirroring how
        // `lastSim` is cached regardless of connection, so a device joining after an idle secret-change
        // catches up on the latest secret rather than a stale one. Delivery (publish) stays gated on a
        // live connection below. `current` is reloaded from the store each tick, so a changed secret
        // has to be saved to survive; the idle branch below does exactly that write and nothing else.
        this.persistPrivate(current, result.private);
        // Idle guard: with ZERO connected devices there is nobody to stream to and no move can land,
        // so skip the broadcast AND the per-tick save while idle (the world still stepped, and the
        // newest sim is cached so a reconnecting device catches up). The `over` end path below still
        // runs regardless, so an idle game still ends and disposes. Correctness holds: the save only
        // persists a rebuild snapshot, no rebuild can happen with no devices, and the next connected
        // tick saves again. The one exception is a secret that CHANGED on this idle tick: persist that
        // one save so a later joiner's catch-up serves the latest secret, not a stale one (spec 0052).
        const anyConnected = current.players.some((p) => p.connected);
        if (anyConnected) {
          // Send this round's re-emitted secret targeted to each live recipient (persist already ran).
          await this.sendPrivate(current, result.private);
          await this.store.save(current);
          if (result.sim != null) await this.publish(current, this.simMessage(current, result.sim));
        } else if (result.private != null) {
          await this.store.save(current);
        }
        if (result.over) {
          this.stopSimLoop(key);
          await this.endGame(current, runtime);
          await this.store.save(current);
        }
      })
        .catch((error: unknown) => {
          // The tick rejected: the worker crashed or its call timed out and was killed. The next
          // interval respawns it and rebuilds the world from scratch. Guard against thrash - if it
          // keeps failing, stop the loop so we do not kill/respawn/rebuild forever (spec 0045).
          const failures = (this.simFailures.get(key) ?? 0) + 1;
          this.simFailures.set(key, failures);
          if (failures >= MAX_SIM_TICK_FAILURES) {
            this.logger.error(
              `[game-engine] sim loop ${key} failed ${failures} ticks in a row; stopping it`,
              error,
            );
            this.stopSimLoop(key);
          }
        })
        .finally(() => this.simTicking.delete(key));
    }, TICK_MS);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    this.simTimers.set(key, timer);
  }

  /** Stop and clear a session's sim loop (freeze the live world). Safe if none is running. */
  private stopSimLoop(key: string): void {
    const timer = this.simTimers.get(key);
    if (timer) clearInterval(timer);
    this.simTimers.delete(key);
    this.simFailures.delete(key);
  }

  /** Freeze the answer countdown when the game pauses mid-`collecting` so it does not tick away. */
  private freezeMoveWindow(state: SessionState): void {
    if (state.phase !== 'collecting' || state.moveDeadline === undefined) return;
    state.moveRemainingMs = Math.max(0, state.moveDeadline - this.clock());
    state.moveDeadline = undefined;
  }

  /** Continue a frozen answer countdown from the time left and re-arm the force-close timer. */
  private async resumeMoveWindow(state: SessionState, runtime: SessionRuntime): Promise<void> {
    if (state.phase !== 'collecting' || state.paused) return;
    if (state.moveWindowMs > 0) {
      const remaining = state.moveRemainingMs ?? state.moveWindowMs;
      state.moveDeadline = this.clock() + remaining;
      state.moveRemainingMs = undefined;
      this.armMoveWindow(state, remaining);
    }
    // The pause also cancelled the all-answered 2s grace, so if the table had already finished, the
    // round would otherwise wait out the full window on resume. Re-arm it (feedback 0015).
    if (await runtime.allSubmitted(this.context(state))) this.armAutoAdvance(state);
  }

  /**
   * Resume the guess window after a pause or host-reconnect: re-arm the force-close timer and, if
   * every connected player already guessed while the game was paused, re-arm the all-decided grace
   * close too. The pause cancelled the in-flight grace timer, so without this an all-guessed round
   * would strand until a manual advance - the `guessing` analogue of {@link resumeMoveWindow}'s
   * all-answered re-arm (feedback 0015).
   */
  private async resumeDecisionWindow(state: SessionState, runtime: SessionRuntime): Promise<void> {
    if (state.phase !== 'guessing' || state.paused) return;
    this.resumeWindow(state, 'guessing');
    if (await runtime.allDecided(this.context(state))) this.armAutoAdvance(state, 'guessing');
  }

  /**
   * The timed-window duration for a phase: the guess window for `guessing`, the leaderboard
   * auto-advance dwell for `leaderboard` (spec 0068), else the dispute window. A 0 means the phase is
   * host-advanced (no timer).
   */
  private windowMsFor(state: SessionState, phase: SessionState['phase']): number {
    if (phase === 'guessing') return state.decisionWindowMs;
    if (phase === 'leaderboard') return state.leaderboardWindowMs;
    return state.disputeWindowMs;
  }

  /**
   * Arm the dispute/voting/guess/leaderboard window timer; a no-op when the window is manual (0) or
   * paused. `delayMs` overrides the phase's full duration so a resume can re-arm for the time LEFT
   * (see {@link resumeWindow}). The prior window timer for this session is cancelled first, so a
   * superseding arm - a phase transition, a resume, a re-base - never leaves a stale timer to fire.
   * On fire, the guard re-checks phase, round, runId, and pause - like {@link armAutoAdvance}/
   * {@link armMoveWindow} - so a stale timer from an earlier round or a pre-restart run no-ops rather
   * than advancing a later one. `windowDeadline` records when the window would close so a pause can
   * compute the time left ({@link freezeWindow}); it is not re-checked on fire because pause always
   * cancels + re-arms, so a timer only ever fires for the deadline it was armed with.
   */
  private armWindow(state: SessionState, phase: SessionState['phase'], delayMs?: number): void {
    const key = sessionKey(state.room, state.game);
    // Cancel any prior window timer so a phase change, resume, or re-base never leaves one pending.
    this.windowTimers.get(key)?.();
    this.windowTimers.delete(key);
    const ms = delayMs ?? this.windowMsFor(state, phase);
    if (ms <= 0 || state.paused) {
      state.windowDeadline = undefined;
      return;
    }
    state.windowDeadline = this.clock() + ms;
    const { room, game, round, runId } = state;
    const cancel = this.scheduler.schedule(Math.max(0, ms), () => {
      this.windowTimers.delete(key);
      void this.run(key, async () => {
        const current = await this.store.load(room, game);
        // Fire only for the same run's same round still in the phase we armed for and unpaused. The
        // round/runId guard stops a stale timer from an earlier round or a pre-restart run from
        // advancing a later one.
        if (
          !current ||
          current.paused ||
          current.phase !== phase ||
          current.round !== round ||
          current.runId !== runId
        ) {
          return;
        }
        await this.advanceLocked(current, await this.runtimeFor(current));
      });
    });
    this.windowTimers.set(key, cancel);
  }

  /**
   * Freeze the dispute/voting/guess/leaderboard window when the game pauses (spec 0068): cancel the
   * pending timer and stash the time left (from `windowDeadline`), so a resume continues from there
   * rather than starting a fresh full window - and so the stale pre-pause timer never fires. A no-op
   * when no timed window is open.
   */
  private freezeWindow(state: SessionState): void {
    const key = sessionKey(state.room, state.game);
    this.windowTimers.get(key)?.();
    this.windowTimers.delete(key);
    if (state.windowDeadline === undefined) return;
    state.windowRemainingMs = Math.max(0, state.windowDeadline - this.clock());
    state.windowDeadline = undefined;
  }

  /** Continue a frozen window from the time left (spec 0068); a fresh full window if none was frozen. */
  private resumeWindow(state: SessionState, phase: SessionState['phase']): void {
    const remaining = state.windowRemainingMs;
    state.windowRemainingMs = undefined;
    this.armWindow(state, phase, remaining);
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

  /**
   * Deliver a lifecycle result's per-player private payloads (spec 0052): persist then send. For each
   * (playerId -> payload) entry the engine stores the latest payload in `state.privatePayloads` (so a
   * reconnect recovers it via catch-up) and, when that player has a live connection, publishes a
   * `PrivateMessage` to that player's OWN private channel - never the broadcast channel, so no other
   * device receives it. The module runs in a worker and returns plain data; this main-thread path owns
   * the sockets and does the targeted send, mirroring the `move_rejected` reply. A no-op when the
   * result carried no `private`. The idle sim tick calls `persistPrivate`/`sendPrivate` separately so a
   * secret that changes while nobody is connected still updates the catch-up store.
   */
  private async deliverPrivate(
    state: SessionState,
    payloads: Record<string, unknown> | undefined,
  ): Promise<void> {
    this.persistPrivate(state, payloads);
    await this.sendPrivate(state, payloads);
  }

  /**
   * Fold a lifecycle result's per-player payloads into `state.privatePayloads` (spec 0052) WITHOUT
   * publishing. Persistence is split from delivery so a secret that changes on an idle tick (zero
   * connected devices) still updates the catch-up store - mirroring how `lastSim` is cached
   * regardless of connection - and a later joiner recovers the latest secret, not a stale one. A
   * payload for a player not in the roster is ignored: it is game-defined data we cannot route.
   */
  private persistPrivate(state: SessionState, payloads: Record<string, unknown> | undefined): void {
    if (!payloads) return;
    const store = (state.privatePayloads ??= {});
    for (const [player, payload] of Object.entries(payloads)) {
      if (!state.players.some((p) => p.player === player)) continue;
      store[player] = payload;
    }
  }

  /**
   * Publish each per-player payload to that player's OWN private channel (spec 0052) when the device
   * is live - never the broadcast channel, so no other device receives it. A disconnected player is
   * skipped here and recovers its payload from the persisted store on its next join catch-up. Assumes
   * `persistPrivate` already stored the payloads (via `deliverPrivate` or an explicit persist).
   */
  private async sendPrivate(
    state: SessionState,
    payloads: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (!payloads) return;
    for (const [player, payload] of Object.entries(payloads)) {
      const target = state.players.find((p) => p.player === player);
      if (!target || !target.connected) continue;
      await this.pubsub.publish(
        privateChannel(state.room, state.game, player),
        this.privateMessage(state, player, payload),
      );
    }
  }

  private stateMessage(state: SessionState): StateMessage {
    // Tri-state from the game's configure (spec 0069): true = auto-advancing, false = supports it but
    // off, undefined = no auto-advance concept. Passed through verbatim so the client can tell a
    // supported-but-off round game (host must advance) from a game that never auto-advances.
    const autoAdvance = state.autoAdvance;
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
      moveMsRemaining:
        state.moveDeadline !== undefined
          ? Math.max(0, state.moveDeadline - this.clock())
          : state.moveRemainingMs,
      // The TOTAL answer window (spec 0069), so the client colours the countdown as a percentage of
      // the whole. Constant across the game; absent when this game has no move timer.
      moveWindowMs: state.moveWindowMs > 0 ? state.moveWindowMs : undefined,
      // The game's auto-advance tri-state (spec 0069): true = auto-advancing, false = supported but
      // the host turned it off (so the client surfaces the manual host controls by default),
      // undefined = no auto-advance concept (host controls stay collapsed).
      autoAdvance,
      // Ms left in the current phase's auto-advance dwell - the reveal/leaderboard "continuing in x"
      // (spec 0069). Projected from `windowDeadline` the same skew-proof way as `moveMsRemaining`
      // (frozen remaining while paused). Gated on `autoAdvance === true` (currently auto-advancing):
      // `windowDeadline` is shared with the non-auto-advance dispute/voting/guess windows, so without
      // the gate a reconnect during one of those would wrongly show "Continuing in x". Absent when no
      // dwell is running.
      autoAdvanceMsRemaining:
        autoAdvance === true
          ? state.windowDeadline !== undefined
            ? Math.max(0, state.windowDeadline - this.clock())
            : state.windowRemainingMs
          : undefined,
      // The live answered count, only while collecting (the client pairs it with the connected
      // roster for "x of y"); absent otherwise or when the game does not report it (spec 0069).
      answered: state.phase === 'collecting' ? state.answered : undefined,
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

  /** A live simulation snapshot frame for a live game (spec 0044), broadcast each sim-loop tick. */
  private simMessage(state: SessionState, sim: unknown): SimMessage {
    return {
      v: PROTOCOL_VERSION,
      type: 'sim',
      room: state.room,
      game: state.game,
      sim,
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

  /** A targeted per-player secret frame (spec 0052), delivered only to `player`'s device(s). */
  private privateMessage(state: SessionState, player: string, payload: unknown): PrivateMessage {
    return {
      v: PROTOCOL_VERSION,
      type: 'private',
      room: state.room,
      game: state.game,
      round: state.round,
      player,
      private: payload,
    };
  }

  /** A targeted refusal of one submission, sent by the socket to the submitting device only. */
  private moveRejectedMessage(state: SessionState, reason: string): MoveRejectedMessage {
    return {
      v: PROTOCOL_VERSION,
      type: 'move_rejected',
      room: state.room,
      game: state.game,
      round: state.round,
      reason,
    };
  }
}

/** Re-export so callers can rank standings the same way the default modules do. */
export { rankStandings };
