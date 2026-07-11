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
    // Privacy defaults: replay off, autocapture off, manual pageviews.
    expect(opts.disable_session_recording).toBe(true);
    expect(opts.autocapture).toBe(false);
    expect(opts.capture_pageview).toBe(false);
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

describe('no-op until initialized', () => {
  it('every helper does nothing when init was never called', async () => {
    const a = await load({ NODE_ENV: 'production', NEXT_PUBLIC_POSTHOG_KEY: 'phc_x' });
    a.trackRoomCreated();
    a.trackGameStarted('trivia', 3);
    a.identifyPlayer('CoolCat');
    a.resetAnalytics();
    a.capturePageview('https://branchout.games');
    expect(mockPosthog.capture).not.toHaveBeenCalled();
    expect(mockPosthog.identify).not.toHaveBeenCalled();
    expect(mockPosthog.reset).not.toHaveBeenCalled();
  });
});
