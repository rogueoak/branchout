import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware } from './middleware';
import {
  apexHost,
  apexLoginUrl,
  hostname,
  insiderOrigin,
  insiderRewritePath,
  isInsiderHost,
  isInsiderPath,
  isTrustedHost,
  schemeFrom,
} from './lib/subdomain';

// The middleware itself is a thin adapter over next/server; its routing decisions live in these
// pure helpers (lib/subdomain), unit-tested here without mocking the Next runtime.
describe('subdomain routing helpers (spec 0035)', () => {
  it('detects the insider host in prod and in local/e2e', () => {
    expect(isInsiderHost('insider.branchout.games')).toBe(true);
    expect(isInsiderHost('insider.localhost:3100')).toBe(true);
    expect(isInsiderHost('INSIDER.Branchout.Games')).toBe(true);
    expect(isInsiderHost('branchout.games')).toBe(false);
    expect(isInsiderHost('www.branchout.games')).toBe(false);
    expect(isInsiderHost('admin.branchout.games')).toBe(false);
    expect(isInsiderHost(null)).toBe(false);
  });

  it('strips only the leading label to reach the apex host, keeping the port', () => {
    expect(apexHost('insider.branchout.games')).toBe('branchout.games');
    expect(apexHost('insider.localhost:3100')).toBe('localhost:3100');
  });

  it('builds the insider origin from an apex origin (the outbound link, spec 0039)', () => {
    expect(insiderOrigin('https://branchout.games')).toBe('https://insider.branchout.games');
    expect(insiderOrigin('http://localhost:3100')).toBe('http://insider.localhost:3100');
    // A trailing slash is ignored.
    expect(insiderOrigin('https://branchout.games/')).toBe('https://insider.branchout.games');
    // A non-URL input is returned unchanged (caller falls back to a relative link).
    expect(insiderOrigin('')).toBe('');
  });

  it('builds an absolute apex login URL with the given scheme', () => {
    expect(apexLoginUrl('insider.branchout.games', 'https')).toBe('https://branchout.games/login');
    expect(apexLoginUrl('insider.localhost:3100', 'http')).toBe('http://localhost:3100/login');
  });

  it('rewrites public paths into the insider tree, idempotently', () => {
    expect(insiderRewritePath('/')).toBe('/insider');
    expect(insiderRewritePath('/games')).toBe('/insider/games');
    // An already-prefixed path is left alone - no double /insider.
    expect(insiderRewritePath('/insider')).toBe('/insider');
    expect(insiderRewritePath('/insider/games')).toBe('/insider/games');
  });

  it('recognizes insider-tree paths (for the apex 404 guard)', () => {
    expect(isInsiderPath('/insider')).toBe(true);
    expect(isInsiderPath('/insider/games')).toBe(true);
    // The plural is a near-miss, not the segment (guards against a startsWith slip).
    expect(isInsiderPath('/insiders')).toBe(false);
    expect(isInsiderPath('/')).toBe(false);
  });

  it('normalizes the host header (port stripped, lowercased)', () => {
    expect(hostname('Insider.LocalHost:3100')).toBe('insider.localhost');
    expect(hostname(undefined)).toBe('');
  });

  it('trusts only our own hosts (open-redirect defence)', () => {
    expect(isTrustedHost('branchout.games')).toBe(true);
    expect(isTrustedHost('insider.branchout.games')).toBe(true);
    expect(isTrustedHost('localhost:3100')).toBe(true);
    expect(isTrustedHost('insider.localhost')).toBe(true);
    expect(isTrustedHost('insider.evil.com')).toBe(false);
    expect(isTrustedHost('branchout.games.evil.com')).toBe(false);
    expect(isTrustedHost(null)).toBe(false);
  });

  it('prefers x-forwarded-proto, falling back for direct traffic', () => {
    expect(schemeFrom('https', 'http')).toBe('https');
    expect(schemeFrom('https,http', 'http')).toBe('https');
    expect(schemeFrom(null, 'http')).toBe('http');
    expect(schemeFrom('', 'http')).toBe('http');
  });

  it('appends an origin-validated next and refuses a spoofed host', () => {
    // Trusted host + trusted next -> absolute apex login carrying the return target.
    expect(
      apexLoginUrl('insider.branchout.games', 'https', 'https://insider.branchout.games/'),
    ).toBe('https://branchout.games/login?next=https%3A%2F%2Finsider.branchout.games%2F');
    // Untrusted next is dropped (no ?next=).
    expect(apexLoginUrl('insider.branchout.games', 'https', 'https://evil.com/')).toBe(
      'https://branchout.games/login',
    );
    // Untrusted (spoofed) host -> a relative /login, never an absolute redirect to a stripped host.
    expect(apexLoginUrl('insider.evil.com', 'https', 'https://insider.evil.com/')).toBe('/login');
  });
});

describe('middleware (spec 0035)', () => {
  function reqFor(url: string, headers: Record<string, string> = {}): NextRequest {
    const u = new URL(url);
    return new NextRequest(u, { headers: { host: u.host, ...headers } });
  }

  it('sends a signed-out insider visitor to the apex login with a return target', () => {
    const res = middleware(reqFor('http://insider.localhost:3100/'));
    const location = res.headers.get('location') ?? '';
    const parsed = new URL(location);
    expect(parsed.host).toBe('localhost:3100'); // crossed to the apex, not the gated host
    expect(parsed.pathname).toBe('/login');
    expect(parsed.searchParams.get('next')).toBe('http://insider.localhost:3100/');
  });

  it('rewrites a signed-in insider request into the /insider tree', () => {
    const res = middleware(
      reqFor('http://insider.localhost:3100/', { cookie: 'branchout_session=abc' }),
    );
    const rewrite = res.headers.get('x-middleware-rewrite') ?? '';
    expect(new URL(rewrite).pathname).toBe('/insider');
  });

  it('never builds an absolute redirect to a spoofed (untrusted) host', () => {
    const res = middleware(reqFor('http://insider.evil.com/'));
    const parsed = new URL(res.headers.get('location') ?? '');
    // Resolved against the request's own origin - evil.com's apex is never the redirect target.
    expect(parsed.host).toBe('insider.evil.com');
    expect(parsed.pathname).toBe('/login');
  });

  it('passes apex traffic through untouched (the layout host-guards /insider)', () => {
    const res = middleware(reqFor('http://localhost:3100/insider'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
