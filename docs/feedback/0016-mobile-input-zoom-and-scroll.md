# 0016 - Mobile: input focus-zoom and scroll-to-question

## Symptom

On a phone (iOS Safari):

1. **Tapping a text field zooms the page in.** Focusing the answer input (or any field - nickname,
   rounds, the category select) triggers Safari's auto-zoom, then the player is left zoomed-in and
   has to pinch back out mid-round.
2. **A new question can be off-screen.** When the next round's question appears, the viewport stays
   where it was (e.g. scrolled down on the reveal/leaderboard), so the player has to scroll up to
   read the new prompt.

## Root cause

1. iOS Safari auto-zooms a focused form control whose computed `font-size` is **under 16px**.
   Canopy's `Input`/`select` recipe (`inputVariants()`) renders `text-sm` = 14px, so every field
   trips it. A plain `input {}` rule cannot fix it - a bare element selector (specificity 0,0,1)
   loses to the `text-sm` utility (0,1,0), so the 14px wins.
2. The in-game layout never scrolls; React re-renders the new prompt in place, but the scroll
   position from the previous phase persists.

## Fix

1. `globals.css`: on touch devices (`@media (pointer: coarse)`) set form controls to `16px`. The
   selector is `input:not([hidden])` etc. - the `:not([hidden])` lifts specificity to 0,1,1 so it
   beats `text-sm` without `!important`, and it is scoped to touch so desktop sizing is untouched.
   Pinch-zoom stays enabled (no `maximum-scale`/`user-scalable=no`), so accessibility is preserved.
2. `GameStage`: an effect keyed on the round scrolls the window to the top when a new answer round
   opens (`phase === 'collecting'`), so the fresh question is always in view.

## Learning

- **Prevent iOS input-zoom by sizing the field >= 16px, never by disabling zoom.** The one-line
  temptation (`maximum-scale=1` / `user-scalable=no` on the viewport) breaks pinch-zoom for
  low-vision users; the correct fix is a 16px font-size on the control. And because the offending
  size comes from a utility class, the override needs matching specificity (a `:not([hidden])`
  bump), not a bare element selector - a plain `input { font-size }` silently loses the cascade.
- **A phase change that swaps the primary content should reset the viewport to it.** When the app
  replaces what the player is looking at (a new question) without a navigation, the old scroll
  position is stale; scroll the new content into view on the transition.
