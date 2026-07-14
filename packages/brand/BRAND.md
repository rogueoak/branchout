# Branch out Brand Notes

## Palette

| Role      | Hex       | Usage                                     |
| --------- | --------- | ----------------------------------------- |
| Gold      | `#FBBF24` | Spark gradient start (warm / root end)    |
| Pink      | `#EC4899` | Spark gradient midpoint                   |
| Violet    | `#7C3AED` | Spark gradient end (cool / tip end), glow |
| Gold root | `#d2a463` | Root node -- see rule below               |
| Dark bg   | `#0d0a15` | App icon and OG canvas                    |
| Panel bg  | `#0d1117` | Logo tile background                      |

## The gold root rule

Every Branch out mark carries a single gold node (`#d2a463`) at the root of the branch tree.
It grounds the upward-branching structure and ties the family mark to the rogueoak oak.

Do not remove it, recolor it, or move it to a non-root position.

## Spark gradient

The two-pass neon strokes run warm at root, cool at tips:
`#FBBF24` (gold) -> `#EC4899` (pink) -> `#7C3AED` (violet).

Do not invert the direction. Strokes are rendered in two passes: a wide low-opacity pass
for the glow and a narrow full-opacity pass on top.

## Safe area

Maintain at least 10% of the shorter dimension as clear space on all sides.
Do not place text, other logos, or decorative elements inside the safe area.

## Game marks

Each game has its own 512x512 mark in `assets/game-<id>.svg` (`game-trivia.svg`,
`game-liarliar.svg`). A game mark is a sibling of the house icon, not a reskin: it keeps the
family skeleton so the games read as one set.

- Same canvas as the icon: radial-glow dark tile (`#221836 -> #0d0a15`), the two-pass spark
  strokes, party-color leaf nodes with halos and white highlights.
- **The gold-root rule still applies** - every game mark carries the single gold node
  (`#d2a463`) at the root of its branch structure (the dot of Trivia's question mark, the base
  of Liar Liar's mask stick).
- The game's idea is expressed by _bending the branch graph_, not by adding foreign shapes:
  Trivia bends it into a question mark; Liar Liar shapes it into a masquerade mask on a stick.
- Keep leaf-node colors from the party set already in use; do not invent new hues.

To add a game mark, copy an existing `game-*.svg` as the skeleton, reshape the branch, keep the
gold root, then export it from `packages/brand` (`src/<id>.ts` + `brand.ts`) and add it to the
raster script if it needs a share card.

## Hero illustrations

Some surfaces want a wider "scene" than the compact 512 mark - the home teaser cards use one
(spec `0046`). A hero lives in `assets/hero-<game>.svg` at an 800x450 (~16:9) viewBox and is the
same family as the mark, just composed wide: the radial-glow dark tile, the two-pass spark strokes,
party leaf nodes, and **the single gold root `#d2a463`** (the gold-root rule applies to heroes too).
The branch motif (Trivia's question mark, Liar Liar's mask) sits to one side with a system-font
wordmark + tagline beside it (the `-apple-system, ... , sans-serif` stack, since no fonts are
embedded). Export a hero from `packages/brand` the same way as a mark (`src/hero-<game>.ts` +
`tsup.config.ts` entry + `package.json` export + `brand.ts`).

## Do not restyle the mark ad hoc

The SVGs in `assets/` are the source of truth. Do not:

- Add drop shadows, filters, or extra effects.
- Change node colors (each leaf carries a specific party color).
- Modify gradient direction or colors.
- Alter proportions or remove elements.

To evolve the brand, update the SVG source and re-run `pnpm --filter @branchout/brand build`.

## Generated files (do not commit)

- `packages/brand/dist/favicon-16.png`
- `packages/brand/dist/favicon-32.png`
- `packages/brand/dist/favicon-180.png`
- `packages/brand/dist/og-1200x630.png`
- `packages/brand/dist/share-trivia.png`
- `packages/brand/dist/share-liarliar.png`
- `packages/brand/dist/share-join.png`
- `apps/web/public/favicon-16.png`
- `apps/web/public/favicon-32.png`
- `apps/web/public/apple-touch-icon.png`
- `apps/web/public/og.png`
- `apps/web/public/share-trivia.png`
- `apps/web/public/share-liarliar.png`
- `apps/web/public/share-join.png`
