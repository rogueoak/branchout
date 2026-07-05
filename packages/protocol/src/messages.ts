// The wire protocol shared across web, control-plane, and game-engine. Start minimal: an
// `echo` message (proves the transport end to end) and an `error` frame the server sends back
// when it cannot understand a client message. Real game messages grow from here.

export interface EchoMessage {
  type: 'echo';
  payload: string;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type ProtocolMessage = EchoMessage | ErrorMessage;

/** Thrown when raw bytes off the wire are not a valid protocol message. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Encode a protocol message for the wire. */
export function serializeMessage(message: ProtocolMessage): string {
  return JSON.stringify(message);
}

/**
 * Decode and validate a raw wire frame. Throws {@link ProtocolError} on anything that is not a
 * well-formed protocol message, so callers never see a half-parsed object.
 */
export function parseMessage(raw: string): ProtocolMessage {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ProtocolError('message is not valid JSON');
  }

  if (!isRecord(data) || typeof data.type !== 'string') {
    throw new ProtocolError('message is missing a string "type"');
  }

  switch (data.type) {
    case 'echo':
      if (typeof data.payload !== 'string') {
        throw new ProtocolError('echo message needs a string "payload"');
      }
      return { type: 'echo', payload: data.payload };
    case 'error':
      if (typeof data.message !== 'string') {
        throw new ProtocolError('error message needs a string "message"');
      }
      return { type: 'error', message: data.message };
    default:
      throw new ProtocolError(`unknown message type: ${data.type}`);
  }
}
