import type { StartHandoffRequest, StartHandoffResponse } from '@branchout/protocol';
import { PROTOCOL_VERSION } from '@branchout/protocol';
import type { ControlAction, EngineClient } from './engine-client';

/**
 * Fake engine client for tests: records every start handoff and control call so a test can assert
 * the opaque config was passed through unchanged and a control reached the engine, without a live
 * engine. Optionally fails to exercise the refusal path: `failStart` throws a plain error, or set
 * `startError` to a specific {@link EngineError} to exercise the route's reached/unreachable mapping.
 */
export class FakeEngineClient implements EngineClient {
  readonly starts: StartHandoffRequest[] = [];
  readonly controls: { room: string; game: string; action: ControlAction }[] = [];

  /** When set, `start` throws this instead of recording - lets a test drive the EngineError path. */
  startError?: Error;

  constructor(private readonly failStart = false) {}

  async start(request: StartHandoffRequest): Promise<StartHandoffResponse> {
    if (this.startError) {
      throw this.startError;
    }
    if (this.failStart) {
      throw new Error('engine unavailable');
    }
    this.starts.push(request);
    return { v: PROTOCOL_VERSION, room: request.room, game: request.game, status: 'started' };
  }

  async control(room: string, game: string, action: ControlAction): Promise<void> {
    this.controls.push({ room, game, action });
  }
}
