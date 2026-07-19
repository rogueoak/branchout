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

  it.each([
    ['triviaSvg', triviaSvg],
    ['liarLiarSvg', liarLiarSvg],
    ['zingerSvg', zingerSvg],
    ['bramblesSvg', bramblesSvg],
    ['nightleafSvg', nightleafSvg],
    ['sketchySvg', sketchySvg],
    ['whispergroveSvg', whispergroveSvg],
    ['loneLeafSvg', loneLeafSvg],
    ['reversiSvg', reversiSvg],
    ['chessSvg', chessSvg],
    ['oddBirdSvg', oddBirdSvg],
    ['checkersSvg', checkersSvg],
    ['sameBranchSvg', sameBranchSvg],
  ])(
    '%s is a 512 game mark that keeps the gold root (the gold-root rule holds for games)',
    (_name, svg) => {
      expect(svg).toMatch(/^<svg /);
      expect(svg).toContain('viewBox="0 0 512 512"');
      // Every mark in the family carries the single gold root node.
      expect(svg).toContain('#d2a463');
    },
  );

  it.each([
    ['heroTriviaSvg', heroTriviaSvg],
    ['heroLiarLiarSvg', heroLiarLiarSvg],
    ['heroTeeterTowerSvg', heroTeeterTowerSvg],
    ['heroBramblesSvg', heroBramblesSvg],
    ['heroNightleafSvg', heroNightleafSvg],
    ['heroSketchySvg', heroSketchySvg],
    ['heroWhispergroveSvg', heroWhispergroveSvg],
    ['heroReversiSvg', heroReversiSvg],
    ['heroChessSvg', heroChessSvg],
    ['heroCheckersSvg', heroCheckersSvg],
    ['heroSameBranchSvg', heroSameBranchSvg],
    ['heroOddBirdSvg', heroOddBirdSvg],
    ['heroLoneLeafSvg', heroLoneLeafSvg],
    ['heroZingerSvg', heroZingerSvg],
  ])(
    '%s is a wide 800x450 hero illustration that keeps the gold root (spec 0046)',
    (_name, svg) => {
      expect(svg).toMatch(/^<svg /);
      // The hero is a wider "scene" (roughly 16:9), not the compact 512 mark.
      expect(svg).toContain('viewBox="0 0 800 450"');
      // The gold-root rule holds for the hero art too.
      expect(svg).toContain('#d2a463');
    },
  );

  it.each([
    ['heroPortraitTriviaSvg', heroPortraitTriviaSvg],
    ['heroPortraitLiarLiarSvg', heroPortraitLiarLiarSvg],
  ])(
    '%s is a 600x800 portrait hero illustration that keeps the gold root (spec 0067)',
    (_name, svg) => {
      expect(svg).toMatch(/^<svg /);
      // The portrait hero is a 3:4 scene for the mobile home carousel, not the wide 16:9 hero.
      expect(svg).toContain('viewBox="0 0 600 800"');
      // The gold-root rule holds for the portrait art too.
      expect(svg).toContain('#d2a463');
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
