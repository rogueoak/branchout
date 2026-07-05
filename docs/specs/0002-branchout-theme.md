# 0002 - Branch out Confetti theme

## Problem

Branch out needs its own look - bright, fun, exciting - while reusing canopy so every component
stays consistent and accessible. Canopy ships an earthy moss brand; Branch out is a party-game
platform and wants the "Confetti" palette (violet + hot pink + sunny yellow). You need that
brand mapped onto canopy's semantic roles so all canopy components re-theme, in light and dark,
without forking anything or restyling components.

Depends on: canopy's brandable theme API, delivered in rogueoak/canopy PR #37
(`@rogueoak/roots/brand` - a `buildBrand()` function and a `roots-brand` CLI), and a
`@rogueoak/roots` release that includes it. This spec consumes that API; it does not build it.

## Outcome

- `packages/theme` produces the Branch out brand: canopy's semantic roles repointed at Confetti
  primitive ramps, for light and dark.
- `apps/web` imports the theme after `@rogueoak/roots`; every canopy component renders in
  Confetti colors with no per-component overrides.
- Toggling `.dark` on `<html>` flips the whole UI, as in canopy.
- Every semantic role is mapped in both themes and passes WCAG AA - the build fails if not.

## Scope

In:
- Confetti primitive ramps (below) authored as canopy-style DTCG tokens.
- Semantic light + dark mappings using canopy's exact role names.
- `packages/theme` holding the Confetti DTCG token files (primitives + light/dark semantic
  mappings) and a `brand.config.json`, built via `@rogueoak/roots/brand` (`buildBrand()` or the
  `roots-brand` CLI) into a `brand.css` the web app imports after `@rogueoak/roots/tokens.css`.
- AA-contrast check over every role and interaction state in both themes (reuse canopy's guard).
- A short theme README: how to import it and how to add a role if canopy adds one.

Out:
- Building the brand API itself (canopy's PR). Component work and page layouts (later specs).
- A user-facing theme switcher; only the default Confetti brand + light/dark here.

## Approach

Keep semantic role names identical to canopy so nothing in the component layer changes. Only the
primitive ramps and the role -> primitive references differ. Author four brand ramps plus the
functional ramps, then map roles.

Generate the theme with `@rogueoak/roots/brand`: point `buildBrand()` (or the `roots-brand` CLI
via `brand.config.json`) at the Confetti primitive + semantic + semantic-dark DTCG files. It
emits a `brand.css` with a `:root` block (brand primitives + light roles) and a `.dark` block
(dark roles); the web app imports it after `tokens.css` and it overrides canopy's roles by
cascade - no component changes. `buildBrand()` fails the build on any AA break, unmapped role,
dark value equal to its light value, or a flat-hex dark value, so the guard below is enforced by
the pipeline, not by hand.

### Confetti primitive ramps

- **grape** (violet, drives `primary`): 50 `#F5F3FF` · 100 `#EDE9FE` · 200 `#DDD6FE` ·
  300 `#C4B5FD` · 400 `#A78BFA` · 500 `#8B5CF6` · 600 `#7C3AED` · 700 `#6D28D9` ·
  800 `#5B21B6` · 900 `#4C1D95` · 950 `#2E1065`
- **bubblegum** (pink, drives `secondary`): 50 `#FDF2F8` · 100 `#FCE7F3` · 200 `#FBCFE8` ·
  300 `#F9A8D4` · 400 `#F472B6` · 500 `#EC4899` · 600 `#DB2777` · 700 `#BE185D` ·
  800 `#9D174D` · 900 `#831843` · 950 `#500724`
- **sunbeam** (yellow, drives `accent`): 50 `#FEFCE8` · 100 `#FEF9C3` · 200 `#FEF08A` ·
  300 `#FDE047` · 400 `#FACC15` · 500 `#EAB308` · 600 `#CA8A04` · 700 `#A16207` ·
  800 `#854D0E` · 900 `#713F12` · 950 `#422006`
- **stone** (violet-tinted neutral): 50 `#F7F6FA` · 100 `#EEEDF3` · 200 `#E2E0EC` ·
  300 `#CBC8D8` · 400 `#9C98AE` · 500 `#6E6A80` · 600 `#524E63` · 700 `#3E3A4D` ·
  800 `#2A2738` · 900 `#1B1826` · 950 `#120F1B`
- Functional ramps keep canopy's structure with these anchors: **success** `#16A34A` /
  dark `#4ADE80`; **warning** `#F59E0B` / dark `#FBBF24`; **danger** (rose) `#E11D48` /
  dark `#FB7185`; **info** (cyan) `#06B6D4` / dark `#22D3EE`.

### Semantic mapping (light / dark)

- `bg` stone.50 / stone.950 · `surface` white / stone.900 · `surface-raised` white / stone.800 ·
  `muted` stone.100 / stone.900
- `text` stone.900 / stone.50 · `text-muted` stone.600 / stone.300 ·
  `text-subtle` stone.500 / stone.400 · `text-inverted` stone.50 / stone.900
- `border` stone.200 / stone.700 · `border-strong` stone.300 / stone.600 ·
  `ring` grape.600 / grape.400
- `primary` grape.600 / grape.400 · `primary-foreground` white / grape.950 ·
  `primary-hover` grape.700 / grape.300
- `secondary` bubblegum.500 / bubblegum.400 · `secondary-foreground` white / bubblegum.950 ·
  `secondary-hover` bubblegum.600 / bubblegum.300
- `accent` sunbeam.400 / sunbeam.400 (fill only) · `accent-strong` sunbeam.700 / sunbeam.300
  (for text/icons to hit AA) · `accent-foreground` sunbeam.950 / sunbeam.950
- `success` / `warning` / `danger` / `info` and their `-foreground` from the functional ramps.

These anchors are the design intent; the AA guard is the arbiter. If a pairing fails AA, nudge
the ramp step (not the role name) and note it in `overview/learnings.md`.

## Acceptance

- [ ] `packages/theme` builds a Confetti `brand.css` via `@rogueoak/roots/brand`
      (`buildBrand()` / `roots-brand`) with `:root` (light) and `.dark` blocks covering every
      canopy semantic role.
- [ ] `apps/web` shows canopy components (Button, Card, Badge, Input) in Confetti colors with no
      per-component style overrides; `.dark` flips the whole page.
- [ ] AA check passes for every role and interaction state in both light and dark; the build
      fails on any AA regression or unmapped role.
- [ ] No semantic role name diverges from canopy, so a canopy upgrade needs no component edits.
- [ ] Theme README documents import order and how to extend when canopy adds a role.
