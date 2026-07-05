import { describe, expect, it } from 'vitest';
import { ProtocolError, parseMessage, serializeMessage, type ProtocolMessage } from './messages';

describe('protocol messages', () => {
  it('round-trips an echo message', () => {
    const message: ProtocolMessage = { type: 'echo', payload: 'hello' };
    expect(parseMessage(serializeMessage(message))).toEqual(message);
  });

  it('round-trips an error message', () => {
    const message: ProtocolMessage = { type: 'error', message: 'boom' };
    expect(parseMessage(serializeMessage(message))).toEqual(message);
  });

  it('rejects non-JSON input', () => {
    expect(() => parseMessage('not json')).toThrow(ProtocolError);
  });

  it('rejects an unknown message type', () => {
    expect(() => parseMessage(JSON.stringify({ type: 'nope' }))).toThrow(ProtocolError);
  });

  it('rejects an echo without a string payload', () => {
    expect(() => parseMessage(JSON.stringify({ type: 'echo', payload: 42 }))).toThrow(
      ProtocolError,
    );
  });
});
