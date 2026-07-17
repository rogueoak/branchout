// The avatar SVG payloads (spec 0027), keyed by id. Marks-are-code (specs 0003/0025): the SVG
// source lives in assets/avatars and is inlined at build time by tsup's `.svg` text loader, so the
// built JS is portable (no runtime fs) and works in the App Router without an SVG webpack plugin.
// Web renders these; the pure id list + validators live in the sibling `./avatar-ids` (server-safe).

import type { AvatarId } from './avatar-ids';
import fox from '../../../assets/avatars/avatar-fox.svg';
import frog from '../../../assets/avatars/avatar-frog.svg';
import owl from '../../../assets/avatars/avatar-owl.svg';
import bear from '../../../assets/avatars/avatar-bear.svg';
import deer from '../../../assets/avatars/avatar-deer.svg';
import hedgehog from '../../../assets/avatars/avatar-hedgehog.svg';
import bee from '../../../assets/avatars/avatar-bee.svg';
import ladybug from '../../../assets/avatars/avatar-ladybug.svg';
import mushroom from '../../../assets/avatars/avatar-mushroom.svg';
import cactus from '../../../assets/avatars/avatar-cactus.svg';
import sunflower from '../../../assets/avatars/avatar-sunflower.svg';
import acorn from '../../../assets/avatars/avatar-acorn.svg';

/** Every avatar's SVG string, keyed by id. */
export const AVATAR_SVGS: Record<AvatarId, string> = {
  fox,
  frog,
  owl,
  bear,
  deer,
  hedgehog,
  bee,
  ladybug,
  mushroom,
  cactus,
  sunflower,
  acorn,
};

/** The avatar SVG for an id, or `undefined` for an unknown id (caller renders a fallback). */
export function avatarSvg(id: string): string | undefined {
  return (AVATAR_SVGS as Record<string, string>)[id];
}

export { AVATAR_IDS, type AvatarId } from './avatar-ids';
