'use client';

// The account management UI (spec 0027): edit nickname, pick an avatar, set visibility, view the
// public profile, and log out. Client-side because it hydrates from `/auth/me` and drives the
// account writes. A non-account visitor is sent to log in. Canopy's Button/Input/inputVariants are
// used here; a native <select> backs the visibility enum (the "native select over Radix" learning).

import { Button, Input, buttonVariants, inputVariants } from '@rogueoak/canopy';
import { AVATAR_IDS } from '@branchout/brand/avatar-ids';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { Wordmark } from '../../components/Wordmark';
import {
  AccountApiError,
  fetchMe,
  logout,
  setAvatar,
  setNickname,
  setVisibility,
  type MeAccount,
  type Visibility,
} from '../../lib/account-api';

const VISIBILITY_OPTIONS: { value: Visibility; label: string; hint: string }[] = [
  { value: 'public', label: 'Public', hint: 'Anyone can see your profile.' },
  {
    value: 'friends-only',
    label: 'Friends only',
    hint: 'Only friends (coming soon) - private to everyone else for now.',
  },
  { value: 'private', label: 'Private', hint: 'Only your gamer tag and stars are public.' },
];

export function AccountClient() {
  const router = useRouter();
  const [account, setAccount] = useState<MeAccount | null | undefined>(undefined);
  const [nickname, setNick] = useState('');
  const [savingNick, setSavingNick] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchMe()
      .then((me) => {
        if (!active) return;
        if (me.kind === 'account' && me.account) {
          setAccount(me.account);
          setNick(me.account.nickname);
        } else {
          setAccount(null);
        }
      })
      .catch(() => active && setAccount(null));
    return () => {
      active = false;
    };
  }, []);

  function toMessage(err: unknown): string {
    return err instanceof AccountApiError ? err.message : 'Something went wrong. Try again.';
  }

  async function onSaveNickname() {
    setSavingNick(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await setNickname(nickname);
      setAccount(updated);
      setNotice('Nickname saved.');
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setSavingNick(false);
    }
  }

  async function onPickAvatar(id: string) {
    setError(null);
    setNotice(null);
    try {
      setAccount(await setAvatar(id));
    } catch (err) {
      setError(toMessage(err));
    }
  }

  async function onVisibility(value: Visibility) {
    setError(null);
    setNotice(null);
    try {
      setAccount(await setVisibility(value));
    } catch (err) {
      setError(toMessage(err));
    }
  }

  async function onLogout() {
    try {
      await logout();
    } catch {
      // Best-effort: even if the call fails, send them home; the cookie clear is idempotent.
    }
    router.push('/');
  }

  if (account === undefined) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 bg-bg p-8 text-text">
        <p className="text-body text-text-muted" role="status">
          Loading your account...
        </p>
      </main>
    );
  }

  if (account === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 bg-bg p-8 text-text">
        <h1 className="text-h2">Sign in to manage your account</h1>
        <a href="/login" className={buttonVariants({ variant: 'primary' })}>
          Log in
        </a>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto flex max-w-2xl flex-col gap-10 px-4 py-12 sm:px-6">
        <header className="flex flex-col items-center gap-4 text-center">
          <Wordmark />
          <div className="flex items-center gap-4">
            <Avatar avatar={account.avatar} name={account.nickname} className="h-16 w-16" />
            <div className="flex flex-col text-left">
              <h1 className="text-h2 text-text">{account.nickname}</h1>
              <p className="text-body-sm text-text-muted">@{account.gamerTag}</p>
            </div>
          </div>
          <a
            href={`/u/${encodeURIComponent(account.gamerTag)}`}
            className="text-body-sm text-primary underline-offset-4 hover:underline"
          >
            View your public profile
          </a>
        </header>

        {error ? (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-body-sm text-success">
            {notice}
          </p>
        ) : null}

        <section aria-labelledby="nickname-heading" className="flex flex-col gap-3">
          <h2 id="nickname-heading" className="text-h4 text-text">
            Nickname
          </h2>
          <label htmlFor="nickname" className="sr-only">
            Nickname
          </label>
          <div className="flex gap-2">
            <Input
              id="nickname"
              value={nickname}
              onChange={(event) => setNick(event.target.value)}
              autoComplete="off"
            />
            <Button
              type="button"
              variant="primary"
              onClick={onSaveNickname}
              disabled={savingNick || nickname.trim() === account.nickname}
            >
              {savingNick ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </section>

        <section aria-labelledby="avatar-heading" className="flex flex-col gap-3">
          <h2 id="avatar-heading" className="text-h4 text-text">
            Avatar
          </h2>
          <div
            role="group"
            aria-label="Choose an avatar"
            className="grid grid-cols-4 gap-3 sm:grid-cols-6"
          >
            {AVATAR_IDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-label={`Choose the ${id} avatar`}
                aria-pressed={account.avatar === id}
                onClick={() => onPickAvatar(id)}
                className={`rounded-full p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  account.avatar === id ? 'ring-2 ring-primary' : ''
                }`}
              >
                <Avatar avatar={id} name={id} className="h-full w-full" />
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="privacy-heading" className="flex flex-col gap-3">
          <h2 id="privacy-heading" className="text-h4 text-text">
            Privacy
          </h2>
          <label htmlFor="visibility" className="text-body-sm text-text-muted">
            Who can see your full profile
          </label>
          <select
            id="visibility"
            className={inputVariants()}
            value={account.visibility}
            onChange={(event) => onVisibility(event.target.value as Visibility)}
          >
            {VISIBILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-body-sm text-text-muted">
            {VISIBILITY_OPTIONS.find((o) => o.value === account.visibility)?.hint}
          </p>
        </section>

        <section aria-label="Session" className="flex flex-col gap-3 border-t border-border pt-6">
          <Button type="button" variant="outline" onClick={onLogout}>
            Log out
          </Button>
        </section>
      </div>
    </main>
  );
}
