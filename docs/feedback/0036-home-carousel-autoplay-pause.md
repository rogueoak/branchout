# 0036 - The home hero carousel never truly pauses on touch

## Symptom

The first cut of the home hero carousel (spec 0067) auto-advanced every 5s with the
`embla-carousel-autoplay` plugin configured `stopOnInteraction: false` and only
`stopOnMouseEnter` / `stopOnFocusIn` as pause triggers. Those triggers are hover / focus based -
they never fire on a touch device. On a phone the strip kept rotating: a swipe or a dot tap only
paused it for the duration of the drag, then it resumed yanking the next game in every 5s, moving
cards out from under a reaching finger. The Spectra Player persona flagged it as a **major** on the
PR - both a WCAG 2.2.2 (Pause, Stop, Hide) failure and a violation of the mobile-first
non-negotiable.

## Root cause

`stopOnInteraction: false` tells embla-autoplay to *resume* after any interaction instead of
handing control to the user. Combined with pause triggers that only exist for pointer users
(hover / focus), a touch-only visitor had no way to stop the motion at all. The config was written
for a desktop mental model ("pause while the mouse is over it") on a surface whose primary audience
is mobile-web.

## Fix

Set `stopOnInteraction: true` so the FIRST player interaction - swipe, dot tap, or arrow key -
stops the rotation for good and hands control to the player. Autoplay still runs on load until that
first interaction, and still pauses on hover / focus for pointer users. `prefers-reduced-motion`
already dropped the plugin entirely. Also added a persistent "View game" cue on each slide (the
hover scale never fires on touch, so there was no visible tappability affordance on a phone) and a
unit test that asserts the autoplay plugin is passed when motion is allowed and dropped under
reduced motion.

## Learning

Autoplay pause behaviour must be designed for touch first on a mobile-first surface. `hover` /
`focus` pause triggers do not exist on a phone, and `stopOnInteraction: false` actively fights the
user by resuming. Default carousels to `stopOnInteraction: true` (first interaction wins) and treat
`prefers-reduced-motion` as a hard "no autoplay". Rolled into [[home-hero-carousel]] notes in
`overview/learnings.md`.
