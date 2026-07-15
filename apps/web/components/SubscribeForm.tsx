'use client';

// The newsletter subscribe box (spec 0047). A thin app wrapper around canopy's `SubscribeForm`
// Branch (`@rogueoak/canopy/branches`, spec 0035), which owns the layout, the submit/success/error
// state machine, the optional-Name reveal, the honeypot, and the a11y wiring. This wrapper injects
// only the branchout-specific transport: `onSubscribe` posts { email, name, company } to the
// control-plane's POST /v1/subscribe, which holds the Constant Contact secrets - nothing here knows
// them. The endpoint already accepts an optional `name`, so adopting canopy's component lights up the
// name field the house-built form never sent.

import {
  SubscribeForm as CanopySubscribeForm,
  type SubscribeValues,
} from '@rogueoak/canopy/branches';
import { V1_PREFIX } from '@branchout/protocol';

// Same client/server URL split the rest of the browser code uses (see lib/room-api.ts): the relative
// `/api` base in prod (Caddy strips it), or the published control-plane port in dev.
const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ?? 'http://localhost:4000';

export function SubscribeForm({
  className,
  source = 'games_banner',
}: {
  className?: string;
  /** Which surface this instance renders on - a PII-free analytics dimension canopy forwards to
   *  `onEvent`. Defaults to the /games "coming soon" banner, the only current surface. */
  source?: string;
}) {
  // Perform the subscription. Posts the collected values (including the honeypot) to the control-plane
  // route, which holds the Constant Contact secrets. Rejects with the user-facing message and a
  // machine `reason` (which canopy forwards to `onEvent('failed')` when an analytics sink is wired).
  async function onSubscribe({ email, name, company }: SubscribeValues) {
    let res: Response;
    try {
      res = await fetch(`${CONTROL_PLANE_URL}${V1_PREFIX}/subscribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name, company }),
      });
    } catch {
      throw Object.assign(new Error('Could not reach the server. Please try again.'), {
        reason: 'network',
      });
    }
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (res.ok && json?.ok) return;
    throw Object.assign(
      new Error(
        typeof json?.error === 'string' ? json.error : 'Something went wrong. Please try again.',
      ),
      { reason: `http_${res.status}` },
    );
  }

  return (
    <CanopySubscribeForm
      className={className}
      source={source}
      heading={false}
      onSubscribe={onSubscribe}
      submitLabel="Subscribe"
      submittingLabel="Subscribing..."
      successBadge="You are on the list"
      successMessage="We will let you know when new games land."
    />
  );
}
