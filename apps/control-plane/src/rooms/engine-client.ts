import type { StartHandoffRequest, StartHandoffResponse } from '@branchout/protocol';
import { PROTOCOL_VERSION, V1_PREFIX } from '@branchout/protocol';

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

/** Raised when the engine rejects a start or control call - the room route maps it to a 502. */
export class EngineError extends Error {
  constructor(
    message: string,
    public status: number,
    /**
     * Whether the engine was actually reached. `false` means the transport failed (engine down /
     * wrong URL); `true` means the engine answered but refused the call (e.g. a 400 for a missing
     * data bank or bad config, a 503 at worker cap). The route uses this to avoid reporting a
     * reached-but-refused start as "could not be reached", which hides a data/config fault.
     */
    public reached: boolean = true,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/**
 * Pull the engine's own error text out of a non-ok response so it survives into the EngineError
 * message (and the operator log). The engine answers `{ error: string }` on a refused start; fall
 * back to the raw body, then to nothing. Never throws - diagnostics must not mask the real failure.
 */
async function engineErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return '';
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body.error === 'string' && body.error.length > 0) return body.error;
  } catch {
    // Not JSON - use the raw text below.
  }
  return text;
}

/**
 * Talks to the engine over internal REST (spec 0007): `POST /v1/sessions` for the start handoff and
 * `POST /v1/sessions/:room/:game/control` for host controls (versioned under `/v1`, spec 0033). A
 * shared internal token authenticates the server-to-server call so only the control-plane can start
 * or steer a session.
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
      throw new EngineError(`engine ${what} unreachable: ${detail}`, 502, false);
    }
  }

  async start(request: StartHandoffRequest): Promise<StartHandoffResponse> {
    const response = await this.request(`${this.baseUrl}${V1_PREFIX}/sessions`, request, 'start');
    if (!response.ok) {
      const detail = await engineErrorDetail(response);
      throw new EngineError(
        `engine start failed (${response.status})${detail ? `: ${detail}` : ''}`,
        response.status,
      );
    }
    return (await response.json()) as StartHandoffResponse;
  }

  async control(room: string, game: string, action: ControlAction): Promise<void> {
    const response = await this.request(
      `${this.baseUrl}${V1_PREFIX}/sessions/${encodeURIComponent(room)}/${encodeURIComponent(game)}/control`,
      { v: PROTOCOL_VERSION, action },
      'control',
    );
    if (!response.ok) {
      const detail = await engineErrorDetail(response);
      throw new EngineError(
        `engine control failed (${response.status})${detail ? `: ${detail}` : ''}`,
        response.status,
      );
    }
  }
}
