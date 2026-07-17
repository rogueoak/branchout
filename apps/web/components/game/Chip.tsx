// A single taxonomy chip (spec 0051): the pill used for category and tag labels across the /games
// browser cards and the per-game feature page. Two visual variants - `category` (the primary genre,
// tinted with the brand primary) and `tag` (a facet, muted on the raised surface) - so the same
// class recipe lives in ONE place instead of copy-pasted inline strings that drift on a restyle.
// Renders an <li> since every use sits in a chip list (role="list").

import type { ReactNode } from 'react';

interface ChipProps {
  /** `category` = primary genre (tinted); `tag` = a finer facet (muted). */
  variant: 'category' | 'tag';
  children: ReactNode;
}

const CHIP_CLASS: Record<ChipProps['variant'], string> = {
  category: 'text-body-sm rounded-full bg-primary/10 px-3 py-1 font-medium text-primary',
  tag: 'text-body-sm rounded-full bg-surface-raised px-3 py-1 text-text-muted',
};

export function Chip({ variant, children }: ChipProps) {
  return <li className={CHIP_CLASS[variant]}>{children}</li>;
}
