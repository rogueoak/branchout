import type { StartHandoffRequest, StartHandoffResponse } from '@branchout/protocol';
import { PROTOCOL_VERSION } from '@branchout/protocol';

/**
 * A host control proxied to the engine. `advance` steps the round lifecycle forward (the Trivia
 * collecting -> reveal and leaderboard -> next-round transitions are host-driven, not timed).
 * `exit` also returns the room to the lobby (see service).
 */
export type ControlAction = 'pause' | 'advance' | 'restart' | 'exit';

/**
 * The control-plane's view of the engine: start a game and proxy host controls. Behind an
 * interface so the room service is testable without a live engine; `HttpEngineClient` calls the
 * engine's internal REST API (spec 0007), `FakeEngineClient` records calls in tests.
 */
export interface EngineClient {
  /** Hand a room + opaque config to the engine to start a game (protocol `StartHandoffRequest`). */
  start(request: StartHandoffRequest): Promise<StartHandoffResponse>;
  /** Proxy a host control (pause / advance / restart / exit) to the running session. */
  control(room: string, game: string, action: ControlAction): Promise<void>;
}

/** Raised when the engine rejects a start or control call - the room service maps it to a 502. */
export class EngineError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/**
 * Talks to the engine over internal REST (spec 0007): `POST /sessions` for the start handoff and
 * `POST /sessions/:room/:game/control` for host controls. A shared internal token authenticates
 * the server-to-server call so only the control-plane can start or steer a session.
 */
export class HttpEngineClient implements EngineClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.internalToken) {
      headers['x-internal-token'] = this.internalToken;
    }
    return headers;
  }

  /**
   * Perform a fetch, turning a transport failure (the engine is down or unreachable) into an
   * {@link EngineError} the room route maps to a 502. Without this, a rejected `fetch` is a raw
   * `TypeError` that escapes the route's error handling as an unlogged 500.
   */
  private async request(url: string, body: unknown, what: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new EngineError(`engine ${what} unreachable: ${detail}`, 502);
    }
  }

  async start(request: StartHandoffRequest): Promise<StartHandoffResponse> {
    const response = await this.request(`${this.baseUrl}/sessions`, request, 'start');
    if (!response.ok) {
      throw new EngineError(`engine start failed (${response.status})`, response.status);
    }
    return (await response.json()) as StartHandoffResponse;
  }

  async control(room: string, game: string, action: ControlAction): Promise<void> {
    const response = await this.request(
      `${this.baseUrl}/sessions/${encodeURIComponent(room)}/${encodeURIComponent(game)}/control`,
      { v: PROTOCOL_VERSION, action },
      'control',
    );
    if (!response.ok) {
      throw new EngineError(`engine control failed (${response.status})`, response.status);
    }
  }
}
