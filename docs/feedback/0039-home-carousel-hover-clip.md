# 0039 - Home hero carousel clips a card's top/bottom border on hover/focus

## Symptom

On the home page, hovering (or keyboard-focusing) a card in the featured-games carousel makes it
expand (`hover:scale-[1.02]`) and swap to the primary border colour - but the card's top and bottom
borders get cut off at the moment it grows. The same clipping hides the focus-visible ring on the
top and bottom edges for keyboard users.

## Root cause

Canopy's `CarouselContent` renders the embla viewport with `overflow-hidden` (required for the
horizontal track to clip correctly). Each card fills its slide's full height, so the viewport height
equals the card height with no slack. When the card scales to `1.02` on hover - or draws its
`ring-2` + `ring-offset-2` focus ring - it grows a few pixels past the viewport's top and bottom
edges, and `overflow-hidden` clips exactly that overshoot. The horizontal axis never clipped because
each slide is narrower than the viewport (`basis-3/4` / `md:basis-5/6`), leaving peek room on the
sides; only the vertical axis was flush.

## Fix

Add `py-3` to `CarouselContent` (the flex track that lives *inside* the `overflow-hidden` viewport).
That reserves ~12px of vertical clearance around the cards, so a hover-scaled or focused card's
border/ring stays inside the clip region and remains fully visible. The fix is app-side - no change
to the shared canopy `Carousel` - and a unit test asserts the track keeps a vertical-padding class.

Autoplay was already correct: the carousel auto-advances every 5s via `embla-carousel-autoplay`
(`delay: 5000`), pausing on hover/focus for pointer users and handing control to the player on the
first interaction (`stopOnInteraction: true`, see [[0036-home-carousel-autoplay-pause]]). That
behaviour was verified, not changed.

## Learning

When a design-system carousel clips with `overflow-hidden` on its viewport, any per-item effect that
grows the item's box - `scale`, a focus `ring`/`ring-offset`, a `box-shadow`, an outline - will be
clipped on whichever axis the item sits flush against the viewport. Reserve clearance by padding the
track *inside* the viewport (not the item, which only shrinks the art), sized to cover the largest
overshoot (scale delta + ring offset). Rolled into `overview/learnings.md`.
