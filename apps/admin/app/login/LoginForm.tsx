'use client';

import { buttonVariants } from '@rogueoak/canopy';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { adminLogin, errorMessage } from '../../lib/admin-api';

const inputClass =
  'rounded-md border border-border bg-bg px-3 py-2 text-body text-text ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await adminLogin(email, password);
      if (res.ok) {
        router.push('/users');
        router.refresh();
        return;
      }
      // 401 (bad credentials) and 429 (locked out) both surface a safe message.
      setError(
        res.status === 429 ? 'Too many attempts. Try again later.' : await errorMessage(res),
      );
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
      <label className="flex flex-col gap-1 text-body-sm font-medium text-text">
        Email
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-body-sm font-medium text-text">
        Password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </label>
      {error ? (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className={buttonVariants({ variant: 'primary' })}>
        {busy ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}
