'use client';

// The shared 5x5 grove grid renderer for Whispergrove (spec 0062). Both the Viewer (read-only shared
// screen) and the Remote (a player's controller) render this, so the grove looks the same everywhere.
// Mobile-first: the grid fills the width and reads well at ~360px, with big tap targets.
//
// A leaf paints its state:
//  - REVEALED leaves show their true role's color to everyone (violet / amber / sapling / deadwood).
//  - HIDDEN leaves are neutral wood. When `keyView` is supplied (the Whisperer's secret), a hidden
//    leaf also carries a thin colored ring showing its secret role - the Whisperer alone sees this.
//  - When `onTap` is supplied and it is this device's turn, a tappable hidden leaf is a button.

import type { LeafRole, PublicLeaf, Team } from './protocol';

// The grove's palette is game-specific chrome (the two grove identities + the sapling/Deadwood
// markers) with no canopy token to reuse. The grove hex values are Violet #7c3aed and Amber #f59e0b;
// they recur below in the fill, the Whisperer's secret ring, and the header dot. NOTE: Tailwind's JIT
// only emits an arbitrary-value class it can see as a complete static string, so these classes are
// written out in full (not interpolated) - keep the two grove hexes in sync across the helpers below.

/** Fill + text classes for a leaf whose role is known (revealed). */
export function roleFill(role: LeafRole): string {
  switch (role) {
    case 'violet':
      return 'bg-[#7c3aed] text-white';
    case 'amber':
      return 'bg-[#f59e0b] text-[#3a2600]';
    case 'sapling':
      return 'bg-[#8a8f7a] text-[#20241a]';
    case 'deadwood':
      return 'bg-[#1a1a1a] text-white';
  }
}

/** A short human label for a revealed role, for screen readers + the reveal chip. */
export function roleLabel(role: LeafRole): string {
  switch (role) {
    case 'violet':
      return 'Violet grove';
    case 'amber':
      return 'Amber grove';
    case 'sapling':
      return 'a sapling';
    case 'deadwood':
      return 'the Deadwood';
  }
}

/** A ring color for a hidden leaf whose secret role the Whisperer can see. */
function secretRing(role: LeafRole): string {
  switch (role) {
    case 'violet':
      return 'ring-4 ring-[#7c3aed]';
    case 'amber':
      return 'ring-4 ring-[#f59e0b]';
    case 'sapling':
      return 'ring-4 ring-[#8a8f7a]';
    case 'deadwood':
      return 'ring-4 ring-[#ef4444]';
  }
}

export interface GroveProps {
  leaves: PublicLeaf[];
  /** The Whisperer's secret key (role per leaf), or null - only the Whisperer passes it. */
  keyView?: LeafRole[] | null;
  /** Tap handler for a hidden leaf; omitted (or null) when this device cannot tap. */
  onTap?: ((index: number) => void) | null;
  /** True when tapping is currently allowed (this device's grove turn, guessing, taps left). */
  canTap?: boolean;
}

export function Grove({ leaves, keyView = null, onTap = null, canTap = false }: GroveProps) {
  return (
    <div className="grid grid-cols-5 gap-1.5" role="grid" aria-label="The grove of 25 leaves">
      {leaves.map((leaf) => (
        <Leaf
          key={leaf.index}
          leaf={leaf}
          secret={keyView ? (keyView[leaf.index] ?? null) : null}
          onTap={onTap}
          canTap={canTap}
        />
      ))}
    </div>
  );
}

function Leaf({
  leaf,
  secret,
  onTap,
  canTap,
}: {
  leaf: PublicLeaf;
  secret: LeafRole | null;
  onTap: ((index: number) => void) | null;
  canTap: boolean;
}) {
  const revealed = leaf.revealed && leaf.shown;
  const base =
    'flex aspect-square items-center justify-center rounded-md p-0.5 text-center text-[10px] font-semibold leading-tight break-words select-none sm:text-xs';

  if (revealed) {
    const role = leaf.shown as LeafRole;
    return (
      <div
        role="gridcell"
        aria-label={`${leaf.word}: ${roleLabel(role)}`}
        className={`${base} ${roleFill(role)} opacity-95`}
      >
        {leaf.word}
      </div>
    );
  }

  // Hidden leaf. Wood fill; the Whisperer's secret adds a colored ring. Tappable when allowed.
  const wood = 'bg-[#6b4f2a] text-[#f3ead9]';
  const ring = secret ? secretRing(secret) : '';
  const tappable = canTap && onTap;

  if (tappable) {
    return (
      <button
        type="button"
        aria-label={`Tap ${leaf.word}`}
        onClick={() => onTap(leaf.index)}
        className={`${base} ${wood} ${ring} cursor-pointer transition-transform hover:brightness-110 active:scale-95`}
      >
        {leaf.word}
      </button>
    );
  }

  return (
    <div role="gridcell" aria-label={leaf.word} className={`${base} ${wood} ${ring}`}>
      {leaf.word}
    </div>
  );
}

/** A small colored dot + label for a grove, used in the turn/score header. */
export function GroveDot({ team }: { team: Team }) {
  const color = team === 'violet' ? 'bg-[#7c3aed]' : 'bg-[#f59e0b]';
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden />;
}

/** The display name for a grove. */
export function teamName(team: Team): string {
  return team === 'violet' ? 'Violet grove' : 'Amber grove';
}
