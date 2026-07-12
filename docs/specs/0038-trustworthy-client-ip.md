# 0038 - Trustworthy client IP at the edge

> Small security-hardening change, the follow-up flagged by feedback `0020` (spec `0036`). It touches
> `deploy/docker/Caddyfile` (shares it with `0035`/`0037`, so sequence to avoid a conflict) and a comment
> in `control-plane`. It makes `request.ip` trustworthy so IP-based limits (the `0036` signup cap, and
> `0037`'s admin-login per-IP signal) actually bite.

## Problem

`0036` enabled `Fastify({ trustProxy: true })` so `request.ip` reads `X-Forwarded-For` behind Caddy - but
Caddy's reverse-proxy **appends** to a client-supplied `X-Forwarded-For` rather than replacing it, so the
leftmost value (what `trustProxy: true` treats as the client) is attacker-controlled. `0036` correctly
anchored the login lockout on the account (unforgeable) to stay safe, but left the per-IP signup cap and
any future per-IP signal **best-effort**: an attacker rotates `X-Forwarded-For` to evade them. To make the
client IP a signal we can trust, the **edge** must own it - the app cannot.

## Outcome

- `request.ip` in `control-plane` reflects the **real client IP**, because Caddy overwrites
  `X-Forwarded-For` with the actual connection peer (`{remote_host}`) before proxying, discarding any
  client-injected value. A forged inbound `X-Forwarded-For` no longer changes `request.ip`.
- The `0036` per-IP signup cap becomes meaningful (a source cannot rotate past it by forging the header),
  and `0037`'s admin login inherits a trustworthy per-IP signal.
- Comments/docs that described the client IP as "best-effort/forgeable" are updated to reflect that it is
  now edge-sanitized (with the one remaining assumption named: the droplet is the direct TLS terminator;
  adding a proxy/LB in front would require re-checking the trust chain).

## Scope

In:

- **`deploy/docker/Caddyfile`**: on the `control-plane` `/api` reverse-proxy, set
  `header_up X-Forwarded-For {remote_host}` so Caddy **replaces** the header with the true peer IP instead
  of appending to a forgeable one. (Caddy is the public edge, so `{remote_host}` is the real client.)
  Factor this into a shared `(api)` snippet (splitting `api_ws` into `(ws)` + `(api)`, `api_ws` imports
  both) so the hardening lives in ONE place and every `/api` front - apex, insiders, and `0037`'s admin -
  inherits it without a divergent per-block copy.
- **`apps/control-plane/src/app.ts`** + **`apps/control-plane/src/routes/auth.ts`**: correct the
  `trustProxy` comment and the login/signup comments - `request.ip` is trustworthy on the edge-fronted
  path (so the signup cap is real, not best-effort), and the login account-anchor is justified on its own
  merit (an attacker has many source IPs; the account is the stable dimension), not on XFF forgeability.
  Keep `trustProxy: true`. Name the dev caveat (dev publishes the port with no Caddy).
- **`docs/overview/architecture.md`** + **`docs/feedback/0020-rate-limit-key-anchor.md`**: update the
  "best-effort IP / hardening is a follow-up" note to "edge-sanitized, trustworthy", naming the single
  direct-terminator assumption.

Out:

- **Changing the lockout keys.** Login stays anchored on the account (still the right primary anchor); this
  only makes the *secondary* per-IP signal trustworthy. No behavioural change to the limiter itself.
- **A load balancer / multi-hop trust config.** The droplet terminates TLS directly today; if that changes,
  the trusted-hop configuration is revisited then (noted, not built).
- **Rate-limiting new routes** or new thresholds - purely the IP-trust fix.

## Approach

- **The edge owns the client IP.** Only the component that terminates the client connection knows the true
  peer; an app behind a proxy must be *told* and cannot infer it from a forgeable header. Caddy replacing
  `X-Forwarded-For` with `{remote_host}` is the single authoritative point, so every upstream behind it
  (and `trustProxy` in the app) can trust it. This is why the fix lives at Caddy, not in the limiter.
- **Keep the account anchor.** `0036`'s account-anchored lockout is not weakened or removed; this change
  only upgrades the per-IP cap from best-effort to real, so mass-signup abuse from one source is actually
  bounded.

## Acceptance

- [ ] Caddy sets `X-Forwarded-For` to `{remote_host}` on the control-plane upstream, so a request arriving
      with a forged `X-Forwarded-For` reaches control-plane with the real peer IP (not the forged value).
- [ ] `caddy validate` passes on the updated Caddyfile.
- [ ] The `control-plane` `trustProxy` comment and `architecture.md` / feedback `0020` note describe the
      client IP as edge-sanitized/trustworthy, naming the direct-terminator assumption.
- [ ] No change to the lockout keys or thresholds; `control-plane` tests stay green.
