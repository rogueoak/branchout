// Product analytics (spec 0032). One module owns the PostHog client lifecycle and every event name,
// so call sites use typed helpers instead of hand-writing strings, and there is a single place to
// audit what we send.
//
// First-party + private by construction:
// - `api_host` is a SAME-ORIGIN path (default `/ingest`), rewritten to PostHog by next.config.mjs, so
//   the browser only ever calls our own domain (no third-party tracker hostname; survives blockers).
// - Runs in PRODUCTION ONLY and only when the key is configured - dev, tests, and CI capture nothing.
// - Session replay is OFF and autocapture is OFF, so no gameplay content or arbitrary DOM is sent; we
//   emit only the explicit funnel events below. A signed-in player is identified by their PUBLIC
//   gamer tag - never email, session, or answers.
//
// NEXT_PUBLIC_* are inlined into the browser bundle at BUILD time, so the key must be baked into the
// web image build (see apps/web/Dockerfile / release.yml); a runtime-only env never reaches the browser.

import posthog from 'posthog-js';

/** The same-origin proxy path PostHog talks to; rewritten to the PostHog US hosts in next.config.mjs. */
export const ANALYTICS_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? '/ingest';

/** True only in a deployed build with a key configured. Read at call time (env is build-inlined). */
export function analyticsEnabled(): boolean {
  return process.env.NODE_ENV === 'production' && Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

let started = false;

/** Initialize PostHog once, in the browser, in production with a key. A no-op otherwise (never throws). */
export function initAnalytics(): void {
  if (started || typeof window === 'undefined' || !analyticsEnabled()) return;
  started = true;
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY as string, {
    api_host: ANALYTICS_HOST,
    ui_host: 'https://us.posthog.com',
    // We capture pageviews manually on route change (App Router does not auto-capture correctly).
    capture_pageview: false,
    capture_pageleave: true,
    // Only identified (signed-in) players get a person profile - anonymous visitors stay anonymous.
    person_profiles: 'identified_only',
    // Privacy: no session replay, and no autocapture (which could hoover up gameplay text/DOM). We
    // send only the explicit events below. Client error/exception reporting stays on.
    disable_session_recording: true,
    autocapture: false,
    capture_exceptions: true,
  });
}

function capture(event: string, properties?: Record<string, unknown>): void {
  if (!started) return;
  posthog.capture(event, properties);
}

/** Manual pageview on an App Router route change. `url` is an absolute URL. */
export function capturePageview(url: string): void {
  if (!started) return;
  posthog.capture('$pageview', { $current_url: url });
}

/** Identify a signed-in player by their public gamer tag - never email/session/PII. */
export function identifyPlayer(gamerTag: string): void {
  if (!started || !gamerTag) return;
  posthog.identify(gamerTag);
}

/** Clear identity on logout so a shared device does not bleed one player into the next. */
export function resetAnalytics(): void {
  if (!started) return;
  posthog.reset();
}

// The funnel. Event names live here (greppable, consistent); properties are non-sensitive only.
export const trackRoomCreated = (): void => capture('room_created');
export const trackGamePicked = (game: string): void => capture('game_picked', { game });
export const trackInviteCopied = (): void => capture('invite_copied');
export const trackInviteShared = (): void => capture('invite_shared');
export const trackRoomJoined = (): void => capture('room_joined');
export const trackGameStarted = (game: string, rounds: number): void =>
  capture('game_started', { game, rounds });
export const trackGameCompleted = (game: string): void => capture('game_completed', { game });
