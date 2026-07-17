import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, ProtocolError } from './envelope';
import {
  parseMessage,
  serializeMessage,
  type MoveMessage,
  type JoinMessage,
  type PrivateMessage,
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
    // The token is optional/additive (spec 0064): a join without one omits the field entirely.
    expect('token' in parsed).toBe(false);
  });

  it('parses a join carrying an auth token (spec 0064, additive)', () => {
    const raw = {
      v: PROTOCOL_VERSION,
      type: 'join',
      room: 'r1',
      game: 'stub',
      player: 'p1',
      nickname: 'Ada',
      token: 'r1.stub.p1.9999999999.sig',
    };
    const parsed = parseMessage(JSON.stringify(raw)) as JoinMessage;
    expect(parsed).toEqual(raw);
    expect(parsed.token).toBe('r1.stub.p1.9999999999.sig');
  });

  it('drops a non-string join token to undefined (a bad token is an auth reject, not a parse error)', () => {
    const parsed = parseMessage(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'join',
        room: 'r1',
        game: 'stub',
        player: 'p1',
        nickname: 'Ada',
        token: 42,
      }),
    ) as JoinMessage;
    expect(parsed.token).toBeUndefined();
  });

  it('parses a move', () => {
    const raw = {
      v: PROTOCOL_VERSION,
      type: 'move',
      room: 'r1',
      game: 'stub',
      player: 'p1',
      round: 2,
      move: 'blue',
    };
    const parsed = parseMessage(JSON.stringify(raw)) as MoveMessage;
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

  it('rejects a move with a non-integer round', () => {
    expect(() =>
      parseMessage(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: 'move',
          room: 'r',
          game: 'g',
          player: 'p',
          round: 1.5,
          move: 'x',
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

  it('serializes a private frame and never parses one off the wire (server-only, spec 0052)', () => {
    // A targeted hidden-information frame round-trips through `serializeMessage` (JSON), so the engine
    // can encode it for the wire...
    const message: PrivateMessage = {
      v: PROTOCOL_VERSION,
      type: 'private',
      room: 'r1',
      game: 'stub',
      round: 1,
      player: 'p1',
      private: { key: ['red', 'blue'] },
    };
    expect(JSON.parse(serializeMessage(message))).toEqual(message);
    // ...but ingress REJECTS it, exactly like `move_rejected`: the server only ever sends it, so a
    // hostile client cannot inject a secret by replaying the frame.
    expect(() => parseMessage(serializeMessage(message))).toThrow(ProtocolError);
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
