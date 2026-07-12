import { describe, expect, it } from 'vitest';
import {
  apexHost,
  apexLoginUrl,
  hostname,
  insidersRewritePath,
  isInsidersHost,
  isInsidersPath,
} from './lib/subdomain';

// The middleware itself is a thin adapter over next/server; its routing decisions live in these
// pure helpers (lib/subdomain), unit-tested here without mocking the Next runtime.
describe('subdomain routing helpers (spec 0035)', () => {
  it('detects the insiders host in prod and in local/e2e', () => {
    expect(isInsidersHost('insiders.branchout.games')).toBe(true);
    expect(isInsidersHost('insiders.localhost:3100')).toBe(true);
    expect(isInsidersHost('INSIDERS.Branchout.Games')).toBe(true);
    expect(isInsidersHost('branchout.games')).toBe(false);
    expect(isInsidersHost('www.branchout.games')).toBe(false);
    expect(isInsidersHost('admin.branchout.games')).toBe(false);
    expect(isInsidersHost(null)).toBe(false);
  });

  it('strips only the leading label to reach the apex host, keeping the port', () => {
    expect(apexHost('insiders.branchout.games')).toBe('branchout.games');
    expect(apexHost('insiders.localhost:3100')).toBe('localhost:3100');
  });

  it('builds an absolute apex login URL with the given scheme', () => {
    expect(apexLoginUrl('insiders.branchout.games', 'https')).toBe('https://branchout.games/login');
    expect(apexLoginUrl('insiders.localhost:3100', 'http')).toBe('http://localhost:3100/login');
  });

  it('rewrites public paths into the insiders tree, idempotently', () => {
    expect(insidersRewritePath('/')).toBe('/insiders');
    expect(insidersRewritePath('/games')).toBe('/insiders/games');
    // An already-prefixed path is left alone - no double /insiders.
    expect(insidersRewritePath('/insiders')).toBe('/insiders');
    expect(insidersRewritePath('/insiders/games')).toBe('/insiders/games');
  });

  it('recognizes insiders-tree paths (for the apex 404 guard)', () => {
    expect(isInsidersPath('/insiders')).toBe(true);
    expect(isInsidersPath('/insiders/games')).toBe(true);
    expect(isInsidersPath('/insider')).toBe(false);
    expect(isInsidersPath('/')).toBe(false);
  });

  it('normalizes the host header (port stripped, lowercased)', () => {
    expect(hostname('Insiders.LocalHost:3100')).toBe('insiders.localhost');
    expect(hostname(undefined)).toBe('');
  });
});
