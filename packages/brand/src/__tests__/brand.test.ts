import { describe, it, expect } from 'vitest';
import { iconSvg } from '../icon.js';
import { faviconSvg } from '../favicon.js';
import { logoSvg } from '../logo.js';
import { triviaSvg } from '../trivia.js';
import { liarLiarSvg } from '../liarliar.js';
import { zingerSvg } from '../zinger.js';
import { bramblesSvg } from '../brambles.js';
import { nightleafSvg } from '../nightleaf.js';
import { sketchySvg } from '../sketchy.js';
import { whispergroveSvg } from '../whispergrove.js';
import { loneLeafSvg } from '../loneleaf.js';
import { reversiSvg } from '../reversi.js';
import { chessSvg } from '../chess.js';
import { oddBirdSvg } from '../oddbird.js';
import { checkersSvg } from '../checkers.js';
import { sameBranchSvg } from '../samebranch.js';
import { heroTriviaSvg } from '../hero-trivia.js';
import { heroLiarLiarSvg } from '../hero-liarliar.js';
import { heroPortraitTriviaSvg } from '../hero-portrait-trivia.js';
import { heroPortraitLiarLiarSvg } from '../hero-portrait-liarliar.js';
import { heroPortraitReversiSvg } from '../hero-portrait-reversi.js';
import { heroPortraitCheckersSvg } from '../hero-portrait-checkers.js';
import { heroTeeterTowerSvg } from '../hero-teeter-tower.js';
import { heroBramblesSvg } from '../hero-brambles.js';
import { heroNightleafSvg } from '../hero-nightleaf.js';
import { heroSketchySvg } from '../hero-sketchy.js';
import { heroWhispergroveSvg } from '../hero-whispergrove.js';
import { heroReversiSvg } from '../hero-reversi.js';
import { heroChessSvg } from '../hero-chess.js';
import { heroCheckersSvg } from '../hero-checkers.js';
import { heroSameBranchSvg } from '../hero-samebranch.js';
import { heroOddBirdSvg } from '../hero-oddbird.js';
import { heroLoneLeafSvg } from '../hero-loneleaf.js';
import { heroZingerSvg } from '../hero-zinger.js';
import { palette, goldRootRule, safeArea, sparkGradient } from '../brand-notes.js';

describe('SVG exports', () => {
  it('iconSvg is a valid SVG string with correct viewBox', () => {
    expect(iconSvg).toMatch(/^<svg /);
    expect(iconSvg).toContain('viewBox="0 0 512 512"');
  });

  it('faviconSvg is a valid SVG string with correct viewBox', () => {
    expect(faviconSvg).toMatch(/^<svg /);
    expect(faviconSvg).toContain('viewBox="0 0 512 512"');
  });

  it('logoSvg is a valid SVG string with correct viewBox', () => {
    expect(logoSvg).toMatch(/^<svg /);
    expect(logoSvg).toContain('viewBox="0 0 520 150"');
  });

  // The gold-root rule (spec 0046): every mark carries a warm gold-root node. The default is the
  // family gold #d2a463; the five skinned games (spec 0075) anchor on their own palette gold instead.
  it.each([
    ['triviaSvg', triviaSvg, '#e8b04b'],
    ['liarLiarSvg', liarLiarSvg, '#d9a441'],
    ['zingerSvg', zingerSvg, '#d2a463'],
    ['bramblesSvg', bramblesSvg, '#d2a463'],
    ['nightleafSvg', nightleafSvg, '#d2a463'],
    ['sketchySvg', sketchySvg, '#d2a463'],
    ['whispergroveSvg', whispergroveSvg, '#d2a463'],
    ['loneLeafSvg', loneLeafSvg, '#d2a463'],
    ['reversiSvg', reversiSvg, '#c9a24b'],
    ['chessSvg', chessSvg, '#d2a463'],
    ['oddBirdSvg', oddBirdSvg, '#d2a463'],
    ['checkersSvg', checkersSvg, '#e8c15a'],
    ['sameBranchSvg', sameBranchSvg, '#d2a463'],
  ])('%s is a 512 game mark that carries its gold-root anchor', (_name, svg, gold) => {
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain(gold);
  });

  // The gold-root rule holds for the hero art too, per game (spec 0046, skinned in spec 0075).
  it.each([
    ['heroTriviaSvg', heroTriviaSvg, '#e8b04b'],
    ['heroLiarLiarSvg', heroLiarLiarSvg, '#d9a441'],
    ['heroTeeterTowerSvg', heroTeeterTowerSvg, '#d2a463'],
    ['heroBramblesSvg', heroBramblesSvg, '#d2a463'],
    ['heroNightleafSvg', heroNightleafSvg, '#d2a463'],
    ['heroSketchySvg', heroSketchySvg, '#d2a463'],
    ['heroWhispergroveSvg', heroWhispergroveSvg, '#d2a463'],
    ['heroReversiSvg', heroReversiSvg, '#c9a24b'],
    ['heroChessSvg', heroChessSvg, '#d2a463'],
    ['heroCheckersSvg', heroCheckersSvg, '#e8c15a'],
    ['heroSameBranchSvg', heroSameBranchSvg, '#d2a463'],
    ['heroOddBirdSvg', heroOddBirdSvg, '#d2a463'],
    ['heroLoneLeafSvg', heroLoneLeafSvg, '#d2a463'],
    ['heroZingerSvg', heroZingerSvg, '#d2a463'],
  ])(
    '%s is a wide 800x450 hero illustration that carries its gold-root anchor',
    (_name, svg, gold) => {
      expect(svg).toMatch(/^<svg /);
      // The hero is a wider "scene" (roughly 16:9), not the compact 512 mark.
      expect(svg).toContain('viewBox="0 0 800 450"');
      expect(svg).toContain(gold);
    },
  );

  // The portrait heroes are all skinned games (spec 0075), so each anchors on its own palette gold.
  it.each([
    ['heroPortraitTriviaSvg', heroPortraitTriviaSvg, '#e8b04b'],
    ['heroPortraitLiarLiarSvg', heroPortraitLiarLiarSvg, '#d9a441'],
    ['heroPortraitReversiSvg', heroPortraitReversiSvg, '#c9a24b'],
    ['heroPortraitCheckersSvg', heroPortraitCheckersSvg, '#e8c15a'],
  ])(
    '%s is a 600x800 portrait hero illustration that carries its gold-root anchor',
    (_name, svg, gold) => {
      expect(svg).toMatch(/^<svg /);
      // The portrait hero is a 3:4 scene for the mobile home carousel, not the wide 16:9 hero.
      expect(svg).toContain('viewBox="0 0 600 800"');
      expect(svg).toContain(gold);
    },
  );
});

describe('brand constants', () => {
  it('palette has gold root color', () => {
    expect(palette.goldRoot).toBe('#d2a463');
  });

  it('palette has dark background color', () => {
    expect(palette.darkBg).toBe('#0d0a15');
  });

  it('goldRootRule mentions the color', () => {
    expect(goldRootRule).toContain('#d2a463');
  });

  it('safeArea rule is a non-empty string', () => {
    expect(typeof safeArea).toBe('string');
    expect(safeArea.length).toBeGreaterThan(0);
  });

  it('sparkGradient references palette extremes', () => {
    expect(sparkGradient.from).toBe(palette.gold);
    expect(sparkGradient.to).toBe(palette.violet);
  });
});
