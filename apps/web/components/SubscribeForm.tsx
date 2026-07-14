'use client';

// The newsletter subscribe box (spec 0047). A small, on-theme form built on canopy Input/Label/Button
// (branchout's canopy version does not export a SubscribeForm branch, so this is the house-built
// equivalent of rogueoak's). It posts { email, name?, company } to the control-plane's
// POST /v1/subscribe, which holds the Constant Contact secrets - nothing here knows them.
//
// Mobile-first: a single stacked column that reads well at 360px and scales up. The honeypot
// `company` field is visually hidden but present in the payload so the server can drop naive bots.
// The submit/success/error state machine lives here; the endpoint returns a generic message on
// failure, which we surface verbatim.

import { Button, Input, Label } from '@rogueoak/canopy';
import { V1_PREFIX } from '@branchout/protocol';
import { type FormEvent, useId, useState } from 'react';

// Same client/server URL split the rest of the browser code uses (see lib/room-api.ts): the relative
// `/api` base in prod (Caddy strips it), or the published control-plane port in dev.
const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ?? 'http://localhost:4000';

type Phase = 'idle' | 'submitting' | 'success' | 'error';

export function SubscribeForm({ className }: { className?: string }) {
  const emailId = useId();
  const companyId = useId();
  const [email, setEmail] = useState('');
  // The honeypot: a real user never sees or fills this. A filled value means a bot.
  const [company, setCompany] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPhase('submitting');
    try {
      const res = await fetch(`${CONTROL_PLANE_URL}${V1_PREFIX}/subscribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), company }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && json?.ok) {
        setPhase('success');
        return;
      }
      setError(
        typeof json?.error === 'string' ? json.error : 'Something went wrong. Please try again.',
      );
      setPhase('error');
    } catch {
      setError('Could not reach the server. Please try again.');
      setPhase('error');
    }
  }

  if (phase === 'success') {
    return (
      <p role="status" className={`text-body-sm text-text ${className ?? ''}`}>
        You are on the list. We will let you know when new games land.
      </p>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className={`flex w-full flex-col gap-3 sm:flex-row sm:items-end ${className ?? ''}`}
      noValidate
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor={emailId}>Email</Label>
        <Input
          id={emailId}
          type="email"
          value={email}
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          onChange={(event) => setEmail(event.target.value)}
          required
          aria-describedby={error ? `${emailId}-error` : undefined}
        />
      </div>

      {/* Honeypot: hidden from users and assistive tech, but present in the DOM so a naive bot fills
          it and the server drops the submission. Not `display:none` alone - some bots skip those. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <Label htmlFor={companyId}>Company</Label>
        <input
          id={companyId}
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
        />
      </div>

      <Button
        type="submit"
        variant="primary"
        disabled={phase === 'submitting' || !email.trim()}
        className="shrink-0"
      >
        {phase === 'submitting' ? 'Subscribing...' : 'Subscribe'}
      </Button>

      {error ? (
        <p
          id={`${emailId}-error`}
          role="alert"
          className="text-body-sm text-danger sm:w-full sm:basis-full"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
