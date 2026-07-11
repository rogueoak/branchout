'use client';

import { V1_PREFIX } from '@branchout/protocol';
import { type FormEvent, useState } from 'react';
import { internalNext } from '../../lib/internal-next';

// The control-plane base URL. Overridable per environment; defaults to the local dev port.
const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ?? 'http://localhost:4000';

interface FieldError {
  field?: string;
  message: string;
}

/**
 * Sign-up page. Creates an account through the control-plane and opens a session. Playing
 * needs no account (see anonymous join); this is only for hosts and saved progress. Styling
 * stays minimal on purpose - the Confetti theme lands separately in spec 0002.
 */
export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [gamerTag, setGamerTag] = useState('');
  const [error, setError] = useState<FieldError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${CONTROL_PLANE_URL}${V1_PREFIX}/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, gamerTag }),
      });
      if (res.ok) {
        // Honor a validated internal `next` (a feature-page CTA carries the intended game here), so
        // the account lands straight in the room flow; otherwise show the default "you are in" note.
        const dest =
          typeof window === 'undefined'
            ? null
            : internalNext(new URLSearchParams(window.location.search).get('next'));
        if (dest) {
          window.location.assign(dest);
          return;
        }
        setDone(true);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; field?: string };
      setError({ field: body.field, message: body.error ?? 'Something went wrong. Try again.' });
    } catch {
      setError({ message: 'Could not reach the server. Check your connection and try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
        <h1 className="text-2xl font-bold">You are in</h1>
        <p className="text-gray-600">
          Your account is ready, {gamerTag}. Head back to{' '}
          <a className="underline" href="/">
            Branch Out Games
          </a>{' '}
          and start a room.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="text-sm text-gray-600">
          You only need an account to host or save progress. Joining a room by code is free and
          needs no sign-up.
        </p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 font-normal"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 font-normal"
          />
          <span className="text-xs font-normal text-gray-500">At least 8 characters.</span>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Gamer tag
          <input
            type="text"
            name="gamerTag"
            autoComplete="username"
            required
            value={gamerTag}
            onChange={(event) => setGamerTag(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 font-normal"
          />
          <span className="text-xs font-normal text-gray-500">
            Public and unique. Letters, numbers, - and _. It becomes your nickname, which you can
            change later.
          </span>
        </label>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error.message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-violet-600 px-4 py-2 font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
        >
          {submitting ? 'Creating account...' : 'Create account'}
        </button>
      </form>

      <p className="text-sm text-gray-600">
        Already have an account?{' '}
        <a className="underline" href="/login">
          Log in
        </a>
      </p>
    </main>
  );
}
