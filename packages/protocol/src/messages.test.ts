import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, ProtocolError } from './envelope';
import {
  parseMessage,
  serializeMessage,
  type AnswerMessage,
  type JoinMessage,
  type ProtocolMessage,
  type VoteMessage,
} from './messages';

describe('transport frames', () => {
  it('round-trips an echo message', () => {
    const message: ProtocolMessage = { type: 'echo', payload: 'hello' };
    expect(parseMessage(serializeMessage(message))).toEqual(message);
  });

  it('rejects non-JSON input', () => {
    expect(() => parseMessage('not json')).toThrow(ProtocolError);
  });

  it('rejects an unknown message type', () => {
    expect(() => parseMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'nope' }))).toThrow(
      ProtocolError,
    );
  });

  it('rejects a payload that is not an object', () => {
    expect(() => parseMessage('42')).toThrow(ProtocolError);
    expect(() => parseMessage('null')).toThrow(ProtocolError);
    expect(() => parseMessage('[]')).toThrow(ProtocolError);
  });

  it('rejects an object missing a string type', () => {
    expect(() => parseMessage(JSON.stringify({ payload: 'hi' }))).toThrow(ProtocolError);
  });

  it('rejects an echo without a string payload', () => {
    expect(() => parseMessage(JSON.stringify({ type: 'echo', payload: 42 }))).toThrow(
      ProtocolError,
    );
  });
});

describe('client game frames', () => {
  it('parses a join', () => {
    const raw = {
      v: PROTOCOL_VERSION,
      type: 'join',
      room: 'r1',
      game: 'stub',
      player: 'p1',
      nickname: 'Ada',
    };
    const parsed = parseMessage(JSON.stringify(raw)) as JoinMessage;
    expect(parsed).toEqual(raw);
  });

  it('parses an answer', () => {
    const raw = {
      v: PROTOCOL_VERSION,
      type: 'answer',
      room: 'r1',
      game: 'stub',
      player: 'p1',
      round: 2,
      answer: 'blue',
    };
    const parsed = parseMessage(JSON.stringify(raw)) as AnswerMessage;
    expect(parsed).toEqual(raw);
  });

  it('parses a vote', () => {
    const raw = {
      v: PROTOCOL_VERSION,
      type: 'vote',
      room: 'r1',
      game: 'stub',
      player: 'p2',
      round: 2,
      target: 'p1',
      agree: true,
    };
    const parsed = parseMessage(JSON.stringify(raw)) as VoteMessage;
    expect(parsed).toEqual(raw);
  });

  it('rejects a game frame with an unsupported version', () => {
    expect(() =>
      parseMessage(JSON.stringify({ v: 999, type: 'join', room: 'r', game: 'g', player: 'p' })),
    ).toThrow(ProtocolError);
  });

  it('rejects a game frame missing its version stamp', () => {
    expect(() =>
      parseMessage(JSON.stringify({ type: 'join', room: 'r', game: 'g', player: 'p' })),
    ).toThrow(ProtocolError);
  });

  it('rejects a join missing a required field', () => {
    expect(() =>
      parseMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'join', room: 'r', game: 'g' })),
    ).toThrow(ProtocolError);
  });

  it('rejects an answer with a non-integer round', () => {
    expect(() =>
      parseMessage(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: 'answer',
          room: 'r',
          game: 'g',
          player: 'p',
          round: 1.5,
          answer: 'x',
        }),
      ),
    ).toThrow(ProtocolError);
  });

  it('rejects a vote with a non-boolean agree', () => {
    expect(() =>
      parseMessage(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: 'vote',
          room: 'r',
          game: 'g',
          player: 'p',
          round: 1,
          target: 't',
          agree: 'yes',
        }),
      ),
    ).toThrow(ProtocolError);
  });

  it('rejects an identity field with an unsafe character (channel/key injection)', () => {
    // A ':' in room/game/player would collide the stream channel and idempotency-key composition.
    expect(() =>
      parseMessage(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: 'join',
          room: 'r1:evil',
          game: 'stub',
          player: 'p1',
          nickname: 'Ada',
        }),
      ),
    ).toThrow(ProtocolError);
  });
});
