# @branchout/theme

The Branch out **Confetti** brand: canopy's semantic roles repointed at Confetti primitive ramps
(grape, bubblegum, sunbeam, stone, plus functional ramps), for light and dark. It re-themes every
`@rogueoak/canopy` component with no per-component code, because canopy components read only
semantic roles.

## What it builds

`pnpm build` runs `roots-brand brand.config.json`, which feeds the token files under `tokens/`
through `@rogueoak/roots/brand` (`buildBrand()`) and emits `dist/brand.css`:

- `:root { ... }` - the Confetti primitives (literal hexes) plus the light semantic roles.
- `.dark { ... }` - the dark semantic roles.

The build fails if any role/state pair breaks WCAG AA in either theme, if a canopy role is left
unmapped, or if a dark override equals its light value. A green build is the AA guarantee.

## Import it (in `apps/web`)

Import `brand.css` after canopy's tokens so it wins by cascade:

```css
@import 'tailwindcss';
@import '@rogueoak/roots/tokens.css';
@import '@rogueoak/roots/tailwind-preset.css';
@import '@branchout/theme/brand.css';
```

Toggle `.dark` on `<html>` to flip the whole UI:

```ts
document.documentElement.classList.toggle('dark');
```

## Tokens

- `tokens/primitive.json` - the Confetti ramps. Brand ramps: `grape` (violet, drives `primary`),
  `bubblegum` (pink, `secondary`), `sunbeam` (yellow, `accent`), `stone` (violet-tinted neutral).
  Functional ramps: `clover` (success), `honey` (warning), `cherry` (danger), `lagoon` (info).
  Functional ramps get their own names so a primitive step never collides with a semantic role of
  the same word (e.g. `color.success` the role vs `color.clover.600` the primitive).
- `tokens/semantic.json` - light role -> primitive references, using canopy's exact role names.
- `tokens/semantic.dark.json` - the dark mapping.

## Adding a role when canopy adds one

A new canopy release that adds a semantic role does not break this build - the new role inherits
its canopy default (already AA-verified upstream) until you map it. To adopt it:

1. Add the role to `tokens/semantic.json` and `tokens/semantic.dark.json`, referencing a Confetti
   primitive step. Keep the role name identical to canopy's.
2. Run `pnpm build`. If the pairing fails AA, nudge the ramp step (never the role name) until the
   guard passes, and note the nudge in `docs/overview/learnings.md`.
