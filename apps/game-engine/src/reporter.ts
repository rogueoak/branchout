// The engine's client for the engine -> control-plane channel: it POSTs round results and final
// standings to the control-plane's REST endpoints (spec 0007 Approach: internal REST, made
// idempotent with ids). The engine also dedupes on its side (see engine.ts), so a report is sent
// at most once per round/game per run; the ids let the control-plane dedupe a retry too.

import {
  ENGINE_COMPLETE_SUBPATH,
  ENGINE_ROUNDS_SUBPATH,
  V1_PREFIX,
  type GameCompleteReport,
  type RoundReport,
} from '@branchout/protocol';

export interface ControlPlaneReporter {
  reportRound(report: RoundReport): Promise<void>;
  reportComplete(report: GameCompleteReport): Promise<void>;
}

export interface HttpReporterOptions {
  /**
   * Base URL of the control-plane ORIGIN, e.g. `http://control-plane:4000` - no path suffix. The
   * reporter appends the full versioned intake path (`/v1/engine/...`, spec 0033) itself, so the
   * version stays in code (the shared `V1_PREFIX`), not spread into deploy env.
   */
  baseUrl: string;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
}

/** POSTs reports to the control-plane over REST. */
export class HttpControlPlaneReporter implements ControlPlaneReporter {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpReporterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  async reportRound(report: RoundReport): Promise<void> {
    await this.post(`${V1_PREFIX}${ENGINE_ROUNDS_SUBPATH}`, report);
  }

  async reportComplete(report: GameCompleteReport): Promise<void> {
    await this.post(`${V1_PREFIX}${ENGINE_COMPLETE_SUBPATH}`, report);
  }

  private async post(path: string, body: unknown): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`control-plane ${path} responded ${res.status}`);
    }
  }
}

/** A reporter that drops reports on the floor - used when no control-plane URL is configured. */
export class NoopReporter implements ControlPlaneReporter {
  async reportRound(): Promise<void> {}
  async reportComplete(): Promise<void> {}
}
