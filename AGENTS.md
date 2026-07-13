# Branch Out Games - product rules

Non-negotiables for every change. These live outside the Trellis/Spectra managed blocks below
so updates to those tools never clobber them.

1. **Mobile-first.** Our players are mobile-web users first. Design and build for a phone
   screen, then make it responsive up to larger screens - never the other way around. Every
   player-facing surface must be usable and good-looking at ~360px wide and scale up cleanly.
2. **End-to-end tests for large features.** Large or multi-surface features ship with
   end-to-end tests that prove the flow works and keep it working. No "ship and pray" - if a
   feature matters, its happy path (and the obvious failure paths) are covered by an automated
   test that a change can break.

<!-- trellis:start -->
## Trellis conventions

This repo follows **Trellis** - rogueoak's shared rules for AI agents. Read the rules in
`docs/rules/` and follow them on every change:

- **`docs/rules/guidelines.md`** - how to write and ship: ASCII-only text, and code that passes
  tests, lint, and build before it merges.
- **`docs/rules/conventions.md`** - how code itself is written (APIs versioned in the URL path).
- **`docs/rules/language.md`** - the voice for anything public-facing (READMEs, docs, release
  notes, user-facing strings).

Pull updates with `/trellis-update`.
<!-- trellis:end -->

<!-- spectra:start -->
## Spectra protocol

This repo uses **Spectra** - spec-driven development with learning feedback loops.
Read `docs/spectra/protocol.md` and follow it for every change:

- **Trivial** change → implement directly. **Feature** → spec in `docs/specs/` (get
  approval first). **Bug/feedback** → doc in `docs/feedback/`.
- Multi-step work → a plan in `docs/plans/`, built in a worktree, **tested before commit**,
  reviewed by the personas in `docs/spectra/personas/` via PR comments, merged on approval.
- **Before concluding, reflect**: update the relevant `docs/overview/` living docs
  (`project`, `features`, `architecture`, `learnings`).
<!-- spectra:end -->
