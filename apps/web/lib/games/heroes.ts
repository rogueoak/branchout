// The wide hero illustration for each game, keyed by the catalog slug (== registry game id). These
// are build-time SVG strings from the brand package (not user input), inlined the same way the game
// marks are. Both the public landing teaser and the insider hub read from this one map so the two
// surfaces render the same hero art and can never drift; a slug with no hero falls back to the game
// mark in the shared card reader (getGameCard in catalog.ts always resolves a hero).
import { heroTriviaSvg } from '@branchout/brand/hero-trivia';
import { heroLiarLiarSvg } from '@branchout/brand/hero-liarliar';
import { heroTeeterTowerSvg } from '@branchout/brand/hero-teeter-tower';
import { heroBramblesSvg } from '@branchout/brand/hero-brambles';
import { heroNightleafSvg } from '@branchout/brand/hero-nightleaf';
import { heroSketchySvg } from '@branchout/brand/hero-sketchy';
import { heroWhispergroveSvg } from '@branchout/brand/hero-whispergrove';
import { heroReversiSvg } from '@branchout/brand/hero-reversi';
import { heroChessSvg } from '@branchout/brand/hero-chess';
import { heroCheckersSvg } from '@branchout/brand/hero-checkers';
import { heroSameBranchSvg } from '@branchout/brand/hero-samebranch';
import { heroOddBirdSvg } from '@branchout/brand/hero-oddbird';
import { heroLoneLeafSvg } from '@branchout/brand/hero-loneleaf';
import { heroZingerSvg } from '@branchout/brand/hero-zinger';

/** Every game's wide hero SVG, keyed by slug (== registry id). Public + insider games alike. */
export const GAME_HERO: Record<string, string> = {
  trivia: heroTriviaSvg,
  'liar-liar': heroLiarLiarSvg,
  'teeter-tower': heroTeeterTowerSvg,
  brambles: heroBramblesSvg,
  nightleaf: heroNightleafSvg,
  sketchy: heroSketchySvg,
  whispergrove: heroWhispergroveSvg,
  reversi: heroReversiSvg,
  chess: heroChessSvg,
  checkers: heroCheckersSvg,
  'same-branch': heroSameBranchSvg,
  'odd-bird': heroOddBirdSvg,
  'lone-leaf': heroLoneLeafSvg,
  zinger: heroZingerSvg,
};
