# 0019 - Insiders surface review (spec 0035)

Captured from the persona review of PR #57 (spec 0035). Two player-visible majors, plus the
security/engineer minors that shared a root cause with them.

## Symptom

1. **Broken chrome on the insiders subdomain.** The insiders surface reuses the shared `TopNav` and
   `Footer`, which emit apex-relative links (`/games`, `/privacy`, `/terms`, `/account`). On the
   insiders host the middleware rewrites *every* path into the `/insiders` tree, where only the index
   exists - so a beta tester tapping "Games" or "Privacy" landed on a 404. A dead end on the happy
   path.
2. **The signed-out gate lost the visitor's intent.** Typing `insiders.branchout.games` while logged
   out bounced to the apex `/login` with no context and no way back; after login the "welcome back"
   screen said "start a room" and never returned them to the insiders surface.
3. **Latent Host-header open redirect.** The signed-out redirect built its `Location` from the
   untrusted `Host` header (stripping only the `insiders.` label), so a spoofed `Host` could aim the
   redirect at an arbitrary domain. Not reachable through Caddy in prod, but no independent guard.

## Root cause

A rewrite-based subdomain surface changes what a *relative* link means: on `insiders.`, `/games` is
`insiders.branchout.games/games`, which the middleware sends into the gated tree. Shared chrome was
written for the apex, where relative links are correct, and nothing crossed them back. The gate
redirect, meanwhile, trusted the inbound `Host` and dropped the requested path.

## Fix

- Shared chrome (`TopNav`, `AccountMenu`, `Footer`) gained an optional `linkOrigin`; the insiders
  surface passes its apex origin (`NEXT_PUBLIC_SITE_URL`) so nav/footer/account links are absolute to
  the apex. Surface-owned content (future insider games) stays relative to the insiders host.
- The signed-out redirect now carries an **origin-validated** `?next=` return target; the login page
  honors a trusted `next` and returns the visitor to the surface. `apexLoginUrl` refuses to build an
  absolute URL from an untrusted host (falls back to a relative `/login`), closing the open redirect.
  The session-cookie name is a single shared constant so the edge and SSR reads cannot drift.

## Learning

A shared chrome component on a **rewrite-based subdomain surface** emits host-relative links that
resolve into that surface's own tree and 404 - cross chrome links to the apex (surface-owned content
stays relative). And any gate that redirects across hosts must carry an **origin-validated** return
target and never build an absolute redirect from the inbound `Host` header. Generalized into
`overview/learnings.md`.
