import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the PostHog client so nothing real runs; assert our module drives it correctly.
const mockPosthog = { init: vi.fn(), capture: vi.fn(), identify: vi.fn(), reset: vi.fn() };
vi.mock('posthog-js', () => ({ default: mockPosthog }));

// Load a fresh copy of the module with the given env, so the module-level `started` flag resets and
// the production gate is re-evaluated per case.
async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import('./analytics');
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe('analytics gating (production + key only)', () => {
  it('is a no-op in test/dev even with a key set', async () => {
    const a = await load({ NODE_ENV: 'test', NEXT_PUBLIC_POSTHOG_KEY: 'phc_x' });
    a.initAnalytics();
    a.trackRoomCreated();
    expect(mockPosthog.init).not.toHaveBeenCalled();
    expect(mockPosthog.capture).not.toHaveBeenCalled();
    expect(a.analyticsEnabled()).toBe(false);
  });

  it('is a no-op in production when the key is unset', async () => {
    const a = await load({ NODE_ENV: 'production', NEXT_PUBLIC_POSTHOG_KEY: '' });
    a.initAnalytics();
    expect(mockPosthog.init).not.toHaveBeenCalled();
    expect(a.analyticsEnabled()).toBe(false);
  });

  it('initializes in production with a key, pointed at the first-party /ingest proxy (no third-party host)', async () => {
    const a = await load({
      NODE_ENV: 'production',
      NEXT_PUBLIC_POSTHOG_KEY: 'phc_x',
      NEXT_PUBLIC_POSTHOG_HOST: '/ingest',
    });
    a.initAnalytics();
    expect(mockPosthog.init).toHaveBeenCalledTimes(1);
    const [key, opts] = mockPosthog.init.mock.calls[0];
    expect(key).toBe('phc_x');
    // Data goes to our own origin, not a PostHog hostname (first-party by construction).
    expect(opts.api_host).toBe('/ingest');
    expect(opts.api_host).not.toContain('posthog.com');
    // Privacy defaults: replay off, autocapture off, manual pageviews, cookieless, scrubbed errors.
    expect(opts.disable_session_recording).toBe(true);
    expect(opts.autocapture).toBe(false);
    expect(opts.capture_pageview).toBe(false);
    expect(opts.persistence).toBe('localStorage');
    expect(typeof opts.before_send).toBe('function');
    // Initializing twice is idempotent.
    a.initAnalytics();
    expect(mockPosthog.init).toHaveBeenCalledTimes(1);
  });
});

describe('funnel events (enabled)', () => {
  let a: Awaited<ReturnType<typeof load>>;
  beforeEach(async () => {
    a = await load({ NODE_ENV: 'production', NEXT_PUBLIC_POSTHOG_KEY: 'phc_x' });
    a.initAnalytics();
    mockPosthog.capture.mockClear();
  });

  it('captures every funnel event with only non-sensitive properties', () => {
    a.trackRoomCreated();
    a.trackGamePicked('trivia');
    a.trackInviteCopied();
    a.trackInviteShared();
    a.trackRoomJoined();
    a.trackGameStarted('liar-liar', 5);
    a.trackGameCompleted('trivia');

    expect(mockPosthog.capture.mock.calls).toEqual([
      ['room_created', undefined],
      ['game_picked', { game: 'trivia' }],
      ['invite_copied', undefined],
      ['invite_shared', undefined],
      ['room_joined', undefined],
      ['game_started', { game: 'liar-liar', rounds: 5 }],
      ['game_completed', { game: 'trivia' }],
    ]);
    // No PII/gameplay content ever leaves as a property - only game id and round count.
    for (const [, props] of mockPosthog.capture.mock.calls) {
      if (props) for (const key of Object.keys(props)) expect(['game', 'rounds']).toContain(key);
    }
    // Direct negative guard: no email, session id, or password appears anywhere in what we send, so
    // a future event that smuggled one in (widening the allow-list above) would still be caught here.
    const dump = JSON.stringify(mockPosthog.capture.mock.calls).toLowerCase();
    expect(dump).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/);
    expect(dump).not.toContain('session');
    expect(dump).not.toContain('password');
  });

  it('captures a manual pageview with the current url', () => {
    a.capturePageview('https://branchout.games/games');
    expect(mockPosthog.capture).toHaveBeenCalledWith('$pageview', {
      $current_url: 'https://branchout.games/games',
    });
  });

  it('identifies by a stable non-sensitive id and resets on logout', () => {
    a.identifyPlayer('CoolCat');
    expect(mockPosthog.identify).toHaveBeenCalledWith('CoolCat');
    a.resetAnalytics();
    expect(mockPosthog.reset).toHaveBeenCalledTimes(1);
  });
});

describe('self-init on first use', () => {
  it('a capture before an explicit init still initializes and fires (no dropped first pageview)', async () => {
    // React runs a child pageview effect before the parent provider's init effect; the helper must
    // self-init so the landing pageview is not lost.
    const a = await load({ NODE_ENV: 'production', NEXT_PUBLIC_POSTHOG_KEY: 'phc_x' });
    a.capturePageview('https://branchout.games');
    expect(mockPosthog.init).toHaveBeenCalledTimes(1);
    expect(mockPosthog.capture).toHaveBeenCalledWith('$pageview', {
      $current_url: 'https://branchout.games',
    });
  });

  it('stays a no-op when disabled, even if a helper is called before init', async () => {
    const a = await load({ NODE_ENV: 'test', NEXT_PUBLIC_POSTHOG_KEY: 'phc_x' });
    a.capturePageview('https://branchout.games');
    a.trackRoomCreated();
    expect(mockPosthog.init).not.toHaveBeenCalled();
    expect(mockPosthog.capture).not.toHaveBeenCalled();
  });
});

describe('exception sanitization (before_send)', () => {
  it('redacts email-like text in $exception properties, leaving non-exception props and events alone', async () => {
    const a = await load({ NODE_ENV: 'production', NEXT_PUBLIC_POSTHOG_KEY: 'phc_x' });
    const scrubbed = a.sanitizeBeforeSend({
      event: '$exception',
      properties: {
        $exception_message: 'failed for user ada@example.com',
        $exception_list: [{ value: 'boom ada@example.com' }],
        other: 'kept',
      },
    });
    expect(scrubbed?.properties?.$exception_message).toBe('failed for user [redacted-email]');
    expect((scrubbed?.properties?.$exception_list as { value: string }[])[0].value).toBe(
      'boom [redacted-email]',
    );
    expect(scrubbed?.properties?.other).toBe('kept');

    // A normal (non-exception) event passes through untouched.
    const normal = { event: 'game_started', properties: { game: 'trivia' } };
    expect(a.sanitizeBeforeSend(normal)).toBe(normal);
  });
});
