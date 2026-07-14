# 0030 - Insider nav and landing corrections

Captured from reviewing the shipped insider surface (feedback 0029). The insider chrome and landing
page had four rough edges: the nav's own content links bounced a tester off the insider host, the
landing copy read as two disconnected fragments, and the game card offered no obvious call to play.

## Symptom

1. **The "Games" nav link left the insider surface.** On `insider.branchout.games`, tapping "Games"
   in the top nav sent the browser to the apex public games index (`branchout.games/games`) - a
   tester browsing insider games landed on the public site instead.
2. **The wordmark/home link left the insider surface.** Tapping the wordmark went to the apex home,
   not the insider landing - the tester lost their surface with one tap on the brand lockup.
3. **The landing copy read as two fragments.** The heading was a bare "Insider" and the message sat
   under it as a separate line, left-aligned - not one welcome, and not centered.
4. **The Teeter Tower card had no visible call to action.** The whole card was a link, but nothing
   said "play" - a tester had to guess the card was tappable.

## Root cause

- **The shared `TopNav` crossed EVERY link to the apex on the insider surface.** Its helper
  `to(path) = linkOrigin ? linkOrigin+path : path` was applied uniformly, so once the surface passed
  its apex `linkOrigin` (needed for the genuinely apex-only links: Log in, Sign up, Manage account),
  it also dragged the surface-owned links (Games, the wordmark/home) to the apex. That is too
  aggressive: the existing subdomain learning already says "cross chrome links to the apex; keep
  surface-owned content relative", but the nav had no way to tell the two apart.
- **The landing hand-wrote a bare "Insider" heading and a left-aligned paragraph**, so the identity
  and the welcome never combined and neither was centered.
- **The card wrapped `GameCard` in a bare `<a>` with no play affordance.** The link worked, but the
  card offered no explicit "Play now".

## Fix

- **Surface-aware nav targets.** `TopNav` gained an explicit `insider` flag (threaded from
  `InsiderHome`, alongside the existing `linkOrigin`). The apex-only links now use a renamed
  `toApex()` helper (Log in, Sign up, Manage account still cross to the apex), while the
  surface-owned links are computed from the surface: the wordmark/home is always relative `/` (the
  insider host rewrites `/` into the insider landing), and Games is relative `/` on the insider
  surface (the insider games live on the landing - there is no separate `/insider/games` page) and
  `/games` on the apex. `AccountMenu` and `Footer` are untouched: their apex-only links keep
  crossing via `linkOrigin`.
- **Combined, centered welcome.** `InsiderHome`'s heading + paragraph became one centered welcome:
  "Branch Out Games for Insiders" over "Welcome. Here you will find unreleased games still in
  testing. Give them a while, then tell us what breaks - your feedback shapes what ships." Both are
  centered and the message is capped to a readable measure, mobile-first at 360px. (Phrased in the
  second person per `docs/rules/language.md` - no first person.)
- **A "Play now" CTA on each insider game card.** The card stays one interactive element (the
  wrapping `<a>`, now labelled "Play <game> now"); a short, single-line "Play now" pill sits inside
  it, styled with `buttonVariants({ variant: 'primary' })`. Because the label is short and
  single-line, the recipe's inherited `white-space: nowrap` is safe here (it only overflows a
  content-bearing wrapper, spec 0029). The pill is `aria-hidden` so a screen reader hears the card's
  action once, not a link inside a link. The play link stays relative, so play stays on the insider
  host.

## Learning

- **Surface-owned nav links stay on the host; only apex-only chrome crosses.** A shared chrome
  component on a rewrite-based subdomain must split its links: content the surface itself owns (its
  home, its games listing) stays relative so it resolves on that host, while links to pages that
  only exist on the apex (auth, account, legal) cross via `linkOrigin`. A single "cross everything"
  helper is wrong - it either 404s the apex-only links (if left relative) or exiles the tester off
  the surface (if all crossed). Give the component the surface flag and decide per link.
- **A "card as a link" wants its play affordance INSIDE the one link, not as a second interactive.**
  When the whole card is already a link, add the visible CTA as an `aria-hidden` styled `<span>`
  carrying the card's accessible name on the link - not a nested `<a>`/`<button>` (interactive in
  interactive). A short single-line label may use `buttonVariants()`; the nowrap overflow only bites
  a content-bearing wrapper (spec 0029), not a two-word pill.
