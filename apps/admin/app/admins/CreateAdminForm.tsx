'use client';

import { buttonVariants } from '@rogueoak/canopy';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { createAdmin, errorMessage } from '../../lib/admin-api';

const inputClass =
  'rounded-md border border-border bg-bg px-3 py-2 text-body text-text ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function CreateAdminForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      const res = await createAdmin(email, password);
      if (res.ok) {
        setEmail('');
        setPassword('');
        setDone(true);
        router.refresh();
      } else {
        setError(await errorMessage(res));
      }
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3 sm:max-w-sm" onSubmit={onSubmit} noValidate>
      <label className="flex flex-col gap-1 text-body-sm font-medium text-text">
        Email
        <input
          type="email"
          name="email"
          autoComplete="off"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-body-sm font-medium text-text">
        Password (min 12 characters)
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={12}
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
      {done ? <p className="text-body-sm text-text-muted">Admin created.</p> : null}
      <button
        type="submit"
        disabled={busy}
        className={buttonVariants({ variant: 'primary', size: 'sm' })}
      >
        {busy ? 'Creating...' : 'Create admin'}
      </button>
    </form>
  );
}
