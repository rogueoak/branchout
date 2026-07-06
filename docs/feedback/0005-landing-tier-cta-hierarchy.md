# 0005 - Landing tier CTA hierarchy

## Symptom

On the landing page, all three tier cards (Free / Gathering / Party) carried an identical
"Get started" call to action, and the highlighted "Gathering" tier used a `primary` button
variant. That primary button competed with the hero's single primary "Sign up free" CTA -
two primary actions on one page - and the pricing section read as three interchangeable
cards with no clear emphasis. (Designer persona review of PR #12, major.)

## Root cause

Reaching for a second `primary` button to signal "this tier matters" conflates two jobs:
drawing the eye (visual hierarchy) and marking the one action a view wants (the primary CTA).
The Trellis/spec rule is one primary action per view; a marketing page's hero owns it, so the
tier section must earn emphasis without a competing primary.

## Fix

- The tier CTAs are `secondary` (highlighted tier) and `outline` (the rest) - never `primary`,
  so the hero "Sign up free" stays the single primary action on the page.
- The highlighted tier's emphasis comes from a `Popular` Badge and a `ring-primary` border,
  not from a competing button color.
- "per month" is suppressed on the Free tier so it no longer implies a billing cycle.

## Learning

On any view with a designated primary CTA, give a secondary element emphasis through a badge,
ring, or border - not a second `primary` button. A primary variant marks the one action the
view wants; using it for "look here too" breaks the one-primary-per-view rule and flattens the
real CTA. This generalizes to every page that ranks options (pricing, plan pickers, feature
grids), so it belongs here rather than in one feature's story.
