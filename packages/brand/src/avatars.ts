// The avatar SVG payloads (spec 0027), keyed by id. Marks-are-code (specs 0003/0025): the SVG
// source lives in assets/avatars and is inlined at build time by tsup's `.svg` text loader, so the
// built JS is portable (no runtime fs) and works in the App Router without an SVG webpack plugin.
// Web renders these; the pure id list + validators live in the sibling `./avatar-ids` (server-safe).

import type { AvatarId } from './avatar-ids';
import sprout from '../../../assets/avatars/avatar-sprout.svg';
import berry from '../../../assets/avatars/avatar-berry.svg';
import sunny from '../../../assets/avatars/avatar-sunny.svg';
import bloom from '../../../assets/avatars/avatar-bloom.svg';
import pebble from '../../../assets/avatars/avatar-pebble.svg';
import maple from '../../../assets/avatars/avatar-maple.svg';
import coral from '../../../assets/avatars/avatar-coral.svg';
import indigo from '../../../assets/avatars/avatar-indigo.svg';
import mint from '../../../assets/avatars/avatar-mint.svg';
import plum from '../../../assets/avatars/avatar-plum.svg';
import ember from '../../../assets/avatars/avatar-ember.svg';
import sky from '../../../assets/avatars/avatar-sky.svg';

/** Every avatar's SVG string, keyed by id. */
export const AVATAR_SVGS: Record<AvatarId, string> = {
  sprout,
  berry,
  sunny,
  bloom,
  pebble,
  maple,
  coral,
  indigo,
  mint,
  plum,
  ember,
  sky,
};

/** The avatar SVG for an id, or `undefined` for an unknown id (caller renders a fallback). */
export function avatarSvg(id: string): string | undefined {
  return (AVATAR_SVGS as Record<string, string>)[id];
}

export { AVATAR_IDS, type AvatarId } from './avatar-ids';
