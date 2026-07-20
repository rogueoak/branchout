'use client';

import { V1_PREFIX } from '@branchout/protocol';
import { type FormEvent, useEffect, useState } from 'react';
import { isTrustedHost } from '../../lib/subdomain';
import { internalNext } from '../../lib/internal-next';

// The control-plane base URL. Overridable per environment; defaults to the local dev port.
const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ?? 'http://localhost:4000';

/**
 * A `?next=` return target, kept only if it is safe to return to (open-redirect defence). Two shapes
 * are honored: a same-origin internal PATH (a feature/room deep link, e.g. `/rooms?game=<slug>`, so a
 * signed-out deep-linker resumes into the game after logging in - review #138), or an absolute URL to
 * one of our own hosts (the value can come from a subdomain gate, e.g. insider sends the visitor here
 * to log in and return). Read on the client from the current URL so the page needs no Suspense boundary.
 */
function readTrustedNext(): string | null {
  try {
    const next = new URLSearchParams(window.location.search).get('next');
    if (!next) return null;
    const internal = internalNext(next);
    if (internal) return internal;
    return isTrustedHost(new URL(next).host) ? next : null;
  } catch {
    return null;
  }
}

/**
 * Log-in page. Verifies credentials through the control-plane and opens a session. The identifier
 * accepts an email OR a username (gamer tag) (spec 0072); a wrong identifier or password returns the
 * same generic error - the server never says which was wrong. Styling stays minimal on purpose - the
 * Confetti theme lands separately in spec 0002.
 */
export default function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // An origin-validated return target (e.g. the insider surface that sent a signed-out visitor here).
  const [next, setNext] = useState<string | null>(null);
  useEffect(() => {
    setNext(readTrustedNext());
  }, []);
  // On success, return the visitor to where they came from.
  useEffect(() => {
    if (done && next) window.location.assign(next);
  }, [done, next]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${CONTROL_PLANE_URL}${V1_PREFIX}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier, password }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'Something went wrong. Try again.');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
        <h1 className="text-2xl font-bold">Welcome back</h1>
        {next ? (
          <p className="text-gray-600">
            You are logged in. Taking you back...{' '}
            <a className="underline" href={next}>
              Continue
            </a>
            .
          </p>
        ) : (
          <p className="text-gray-600">
            You are logged in. Head back to{' '}
            <a className="underline" href="/">
              Branch out
            </a>{' '}
            and start a room.
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <h1 className="text-2xl font-bold">Log in</h1>
      {next ? <p className="-mt-4 text-sm text-gray-600">Log in to continue.</p> : null}

      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email or username
          {/* Accepts an email OR a gamer tag (spec 0072), so this is a plain text field, not
              type=email (which would reject a username) and autoComplete=username so a browser
              offers the saved handle. */}
          <input
            type="text"
            name="identifier"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 font-normal"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 font-normal"
          />
        </label>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-violet-600 px-4 py-2 font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
        >
          {submitting ? 'Logging in...' : 'Log in'}
        </button>
      </form>

      <p className="text-sm text-gray-600">
        New to Branch out?{' '}
        <a className="underline" href="/signup">
          Create an account
        </a>
      </p>
    </main>
  );
}
