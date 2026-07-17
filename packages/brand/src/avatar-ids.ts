// The canonical set of player-avatar ids (spec 0027). This module is deliberately PURE DATA - no
// SVG imports, no `sharp`, no raster pipeline - so a server (the control-plane) can import the id
// list to validate a stored avatar without pulling the browser-facing SVG payload or build deps.
// The SVG strings that render each id live in the sibling `./avatars` module, which web consumes.

/**
 * Every avatar a player can choose, in display order. A stored avatar is one of these ids.
 *
 * The set is a cohesive nature-party cast - woodland critters, bugs, and plants, each a friendly
 * face on a Confetti-palette tile with a scatter of confetti (spec 0027). Picking a creature (not a
 * random blob) gives every player a distinct, recognizable identity.
 */
export const AVATAR_IDS = [
  'fox',
  'frog',
  'owl',
  'bear',
  'deer',
  'hedgehog',
  'bee',
  'ladybug',
  'mushroom',
  'cactus',
  'sunflower',
  'acorn',
] as const;

/** One of the known avatar ids. */
export type AvatarId = (typeof AVATAR_IDS)[number];

/** True when `value` is a known avatar id - the bounded-charset check the store validates against. */
export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === 'string' && (AVATAR_IDS as readonly string[]).includes(value);
}

/**
 * A deterministic default avatar derived from the gamer tag, so a fresh account always has one and
 * the same tag always seeds the same avatar (stable across signups and test runs - no randomness).
 * A simple character-sum over the normalized tag indexes into the set.
 */
export function defaultAvatarFor(gamerTag: string): AvatarId {
  const normalized = gamerTag.trim().toLowerCase();
  let sum = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    sum = (sum + normalized.charCodeAt(i)) % AVATAR_IDS.length;
  }
  return AVATAR_IDS[sum]!;
}
