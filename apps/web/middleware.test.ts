import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware } from './middleware';
import {
  apexHost,
  apexLoginUrl,
  hostname,
  insidersRewritePath,
  isInsidersHost,
  isInsidersPath,
  isTrustedHost,
  schemeFrom,
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

  it('trusts only our own hosts (open-redirect defence)', () => {
    expect(isTrustedHost('branchout.games')).toBe(true);
    expect(isTrustedHost('insiders.branchout.games')).toBe(true);
    expect(isTrustedHost('localhost:3100')).toBe(true);
    expect(isTrustedHost('insiders.localhost')).toBe(true);
    expect(isTrustedHost('insiders.evil.com')).toBe(false);
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
      apexLoginUrl('insiders.branchout.games', 'https', 'https://insiders.branchout.games/'),
    ).toBe('https://branchout.games/login?next=https%3A%2F%2Finsiders.branchout.games%2F');
    // Untrusted next is dropped (no ?next=).
    expect(apexLoginUrl('insiders.branchout.games', 'https', 'https://evil.com/')).toBe(
      'https://branchout.games/login',
    );
    // Untrusted (spoofed) host -> a relative /login, never an absolute redirect to a stripped host.
    expect(apexLoginUrl('insiders.evil.com', 'https', 'https://insiders.evil.com/')).toBe('/login');
  });
});

describe('middleware (spec 0035)', () => {
  function reqFor(url: string, headers: Record<string, string> = {}): NextRequest {
    const u = new URL(url);
    return new NextRequest(u, { headers: { host: u.host, ...headers } });
  }

  it('sends a signed-out insiders visitor to the apex login with a return target', () => {
    const res = middleware(reqFor('http://insiders.localhost:3100/'));
    const location = res.headers.get('location') ?? '';
    const parsed = new URL(location);
    expect(parsed.host).toBe('localhost:3100'); // crossed to the apex, not the gated host
    expect(parsed.pathname).toBe('/login');
    expect(parsed.searchParams.get('next')).toBe('http://insiders.localhost:3100/');
  });

  it('rewrites a signed-in insiders request into the /insiders tree', () => {
    const res = middleware(
      reqFor('http://insiders.localhost:3100/', { cookie: 'branchout_session=abc' }),
    );
    const rewrite = res.headers.get('x-middleware-rewrite') ?? '';
    expect(new URL(rewrite).pathname).toBe('/insiders');
  });

  it('never builds an absolute redirect to a spoofed (untrusted) host', () => {
    const res = middleware(reqFor('http://insiders.evil.com/'));
    const parsed = new URL(res.headers.get('location') ?? '');
    // Resolved against the request's own origin - evil.com's apex is never the redirect target.
    expect(parsed.host).toBe('insiders.evil.com');
    expect(parsed.pathname).toBe('/login');
  });

  it('passes apex traffic through untouched (the layout host-guards /insiders)', () => {
    const res = middleware(reqFor('http://localhost:3100/insiders'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
