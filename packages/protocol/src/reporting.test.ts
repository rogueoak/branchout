import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, ProtocolError } from './envelope';
import { parseGameCompleteReport, parseRoundReport, parseStartHandoff } from './reporting';

describe('parseStartHandoff', () => {
  it('parses a valid handoff and passes config through unchanged', () => {
    const config = { rounds: 5, nested: { anything: true } };
    const parsed = parseStartHandoff({
      v: PROTOCOL_VERSION,
      room: 'r1',
      game: 'stub',
      players: [{ player: 'p1', nickname: 'Ada' }],
      config,
    });
    expect(parsed.room).toBe('r1');
    expect(parsed.players).toEqual([{ player: 'p1', nickname: 'Ada' }]);
    expect(parsed.config).toEqual(config);
  });

  it('carries the host flag through ingress validation, defaulting its absence (spec 0014)', () => {
    // Ingress must not silently drop isHost, or the engine can never identify the host to pause on
    // its disconnect - the flag is set upstream but never reaches the roster.
    const parsed = parseStartHandoff({
      v: PROTOCOL_VERSION,
      room: 'r1',
      game: 'stub',
      players: [
        { player: 'p1', nickname: 'Ada', isHost: true },
        { player: 'p2', nickname: 'Bo' },
      ],
      config: {},
    });
    expect(parsed.players[0]).toEqual({ player: 'p1', nickname: 'Ada', isHost: true });
    // A player with no flag stays flag-less (absent, not false) so an older peer is unchanged.
    expect(parsed.players[1]).toEqual({ player: 'p2', nickname: 'Bo' });
  });

  it('rejects a bad version', () => {
    expect(() => parseStartHandoff({ v: 999, room: 'r', game: 'g', players: [] })).toThrow(
      ProtocolError,
    );
  });

  it('rejects players that are not an array', () => {
    expect(() =>
      parseStartHandoff({ v: PROTOCOL_VERSION, room: 'r', game: 'g', players: {} }),
    ).toThrow(ProtocolError);
  });

  it('rejects a player missing a nickname', () => {
    expect(() =>
      parseStartHandoff({
        v: PROTOCOL_VERSION,
        room: 'r',
        game: 'g',
        players: [{ player: 'p1' }],
      }),
    ).toThrow(ProtocolError);
  });

  it('rejects an unsafe room identity (channel/key injection)', () => {
    expect(() =>
      parseStartHandoff({
        v: PROTOCOL_VERSION,
        room: 'r1:evil',
        game: 'stub',
        players: [{ player: 'p1', nickname: 'Ada' }],
        config: {},
      }),
    ).toThrow(ProtocolError);
  });
});

describe('parseRoundReport', () => {
  const valid = {
    v: PROTOCOL_VERSION,
    room: 'r1',
    game: 'stub',
    round: 1,
    roundId: 'r1:stub:1',
    scores: [{ player: 'p1', points: 100, reason: 'correct' }],
    standings: [{ player: 'p1', nickname: 'Ada', score: 100, rank: 1 }],
  };

  it('parses a valid round report', () => {
    expect(parseRoundReport(valid)).toEqual(valid);
  });

  it('requires a roundId for idempotency', () => {
    const { roundId: _omit, ...withoutId } = valid;
    void _omit;
    expect(() => parseRoundReport(withoutId)).toThrow(ProtocolError);
  });

  it('rejects a score event with non-integer points', () => {
    expect(() =>
      parseRoundReport({ ...valid, scores: [{ player: 'p1', points: 1.5, reason: 'x' }] }),
    ).toThrow(ProtocolError);
  });
});

describe('parseGameCompleteReport', () => {
  it('parses a valid completion report', () => {
    const report = {
      v: PROTOCOL_VERSION,
      room: 'r1',
      game: 'stub',
      gameId: 'r1:stub',
      standings: [
        { player: 'p1', nickname: 'Ada', score: 100, rank: 1 },
        { player: 'p2', nickname: 'Bo', score: 50, rank: 2 },
      ],
    };
    expect(parseGameCompleteReport(report)).toEqual(report);
  });

  it('rejects a standings row missing a rank', () => {
    expect(() =>
      parseGameCompleteReport({
        v: PROTOCOL_VERSION,
        room: 'r1',
        game: 'stub',
        gameId: 'r1:stub',
        standings: [{ player: 'p1', nickname: 'Ada', score: 100 }],
      }),
    ).toThrow(ProtocolError);
  });
});
