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
- `apps/web/public/favicon-16.png`
- `apps/web/public/favicon-32.png`
- `apps/web/public/apple-touch-icon.png`
- `apps/web/public/og.png`
