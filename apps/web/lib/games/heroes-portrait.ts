// The portrait (3:4) hero illustration for each game that has one, keyed by the catalog slug (==
// registry game id). These are build-time SVG strings from the brand package (not user input),
// inlined the same way the wide 16:9 heroes (heroes.ts) and the game marks are. The home hero
// carousel (spec 0067) reads this map for its portrait slides; a slug with no portrait hero simply
// gets no carousel-specific art and the card reader falls back to the wide hero. Only the public
// games (Trivia, Liar Liar, Reversi) ship a portrait today - the insider games are gated off the
// home page.
import { heroPortraitTriviaSvg } from '@branchout/brand/hero-portrait-trivia';
import { heroPortraitLiarLiarSvg } from '@branchout/brand/hero-portrait-liarliar';
import { heroPortraitReversiSvg } from '@branchout/brand/hero-portrait-reversi';

/** Portrait hero SVGs keyed by slug (== registry id), for surfaces that show a tall card. */
export const GAME_HERO_PORTRAIT: Record<string, string> = {
  trivia: heroPortraitTriviaSvg,
  'liar-liar': heroPortraitLiarLiarSvg,
  reversi: heroPortraitReversiSvg,
};
