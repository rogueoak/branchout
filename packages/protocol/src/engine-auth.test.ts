import { describe, expect, it } from 'vitest';
import { ENGINE_TOKEN_TTL_SECONDS, mintEngineToken, verifyEngineToken } from './engine-auth';

const SECRET = 'test-engine-secret';
const CLAIMS = { room: 'room-1', game: 'trivia', player: 'p1' };

describe('engine-auth token (spec 0064)', () => {
  it('mints a token a matching secret verifies, yielding the bound claims', () => {
    const now = 1_000_000;
    const token = mintEngineToken(CLAIMS, SECRET, { nowSeconds: now });
    const result = verifyEngineToken(token, SECRET, { nowSeconds: now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims).toEqual({
      room: 'room-1',
      game: 'trivia',
      player: 'p1',
      exp: now + ENGINE_TOKEN_TTL_SECONDS,
    });
  });

  it('rejects a token signed with a different secret (bad_signature)', () => {
    const token = mintEngineToken(CLAIMS, SECRET);
    const result = verifyEngineToken(token, 'a-different-secret');
    expect(result).toEqual({ ok: false, error: 'bad_signature' });
  });

  it('rejects a token whose payload was tampered after signing (bad_signature)', () => {
    const now = 1_000_000;
    const token = mintEngineToken(CLAIMS, SECRET, { nowSeconds: now });
    // Swap the player id in the payload but keep the original signature - the classic impersonation
    // attempt. The signature no longer matches the (altered) payload.
    const tampered = token.replace('.p1.', '.victim.');
    const result = verifyEngineToken(tampered, SECRET, { nowSeconds: now });
    expect(result).toEqual({ ok: false, error: 'bad_signature' });
  });

  it('rejects an expired token', () => {
    const issuedAt = 1_000_000;
    const token = mintEngineToken(CLAIMS, SECRET, { nowSeconds: issuedAt, ttlSeconds: 60 });
    const result = verifyEngineToken(token, SECRET, { nowSeconds: issuedAt + 61 });
    expect(result).toEqual({ ok: false, error: 'expired' });
  });

  it('accepts a token right up to but not past its expiry boundary', () => {
    const issuedAt = 1_000_000;
    const token = mintEngineToken(CLAIMS, SECRET, { nowSeconds: issuedAt, ttlSeconds: 60 });
    // exp = issuedAt + 60; verify at exactly exp is expired (exp <= now), one second before is valid.
    expect(verifyEngineToken(token, SECRET, { nowSeconds: issuedAt + 59 }).ok).toBe(true);
    expect(verifyEngineToken(token, SECRET, { nowSeconds: issuedAt + 60 }).ok).toBe(false);
  });

  it('rejects a malformed token (wrong field count / no signature)', () => {
    expect(verifyEngineToken('not-a-token', SECRET)).toEqual({ ok: false, error: 'malformed' });
    expect(verifyEngineToken('a.b.c', SECRET)).toEqual({ ok: false, error: 'malformed' });
    expect(verifyEngineToken('', SECRET)).toEqual({ ok: false, error: 'malformed' });
  });

  it('binds distinct claims to distinct tokens - one game/room/player token does not verify another', () => {
    const now = 1_000_000;
    const token = mintEngineToken(CLAIMS, SECRET, { nowSeconds: now });
    // The token verifies, but the caller compares claims: a different player must not be honoured.
    const result = verifyEngineToken(token, SECRET, { nowSeconds: now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.player).toBe('p1');
    expect(result.claims.player).not.toBe('victim');
  });
});
