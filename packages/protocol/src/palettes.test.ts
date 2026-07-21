import { describe, expect, it } from 'vitest';
import {
  ALL_PALETTE_COLORS,
  PLAYER_PALETTES,
  PLAYER_PALETTE_IDS,
  getPalette,
  isPaletteId,
  paletteColors,
  pickAvailablePalette,
} from './palettes';

describe('player palettes', () => {
  it('defines 24 palettes, each a distinct id with three hex colors', () => {
    expect(PLAYER_PALETTES.length).toBe(24);
    const ids = new Set(PLAYER_PALETTE_IDS);
    expect(ids.size).toBe(24); // ids are unique
    for (const p of PLAYER_PALETTES) {
      expect(p.id).toMatch(/^[a-z]+$/);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.colors).toHaveLength(3);
      for (const c of p.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      // The three colors within a palette differ.
      expect(new Set(p.colors).size).toBe(3);
    }
  });

  it('keeps every color visible on white (never near-white)', () => {
    // A palette drawn on a white bark must never be near-invisible: reject any color whose channels
    // are all very light.
    for (const p of PLAYER_PALETTES) {
      for (const c of p.colors) {
        const r = parseInt(c.slice(1, 3), 16);
        const g = parseInt(c.slice(3, 5), 16);
        const b = parseInt(c.slice(5, 7), 16);
        expect(Math.min(r, g, b) < 230 || Math.max(r, g, b) < 235).toBe(true);
      }
    }
  });

  it('resolves ids to palettes and colors, and rejects unknown ids', () => {
    expect(isPaletteId('ember')).toBe(true);
    expect(isPaletteId('not-a-palette')).toBe(false);
    expect(isPaletteId(42)).toBe(false);
    expect(getPalette('ember')?.name).toBe('Ember');
    expect(paletteColors('ember')).toEqual(['#781717', '#c52020', '#e94949']);
    expect(paletteColors('nope')).toEqual([]);
    expect(paletteColors(undefined)).toEqual([]);
  });

  it('unions every color across every palette', () => {
    expect(ALL_PALETTE_COLORS.size).toBe(24 * 3);
    expect(ALL_PALETTE_COLORS.has('#e94949')).toBe(true);
    expect(ALL_PALETTE_COLORS.has('#000000')).toBe(false);
  });

  it('picks a random still-available palette, skipping taken ones', () => {
    // rng pinned to 0 selects the first free palette.
    const first = pickAvailablePalette([], () => 0);
    expect(first).toBe(PLAYER_PALETTE_IDS[0]);
    const second = pickAvailablePalette([PLAYER_PALETTE_IDS[0]], () => 0);
    expect(second).toBe(PLAYER_PALETTE_IDS[1]);
  });

  it('returns undefined when every palette is already claimed', () => {
    expect(pickAvailablePalette(PLAYER_PALETTE_IDS)).toBeUndefined();
  });

  it('never returns a taken palette across many random draws', () => {
    const taken = PLAYER_PALETTE_IDS.slice(0, 20);
    for (let i = 0; i < 200; i++) {
      const pick = pickAvailablePalette(taken);
      expect(pick).toBeDefined();
      expect(taken).not.toContain(pick);
    }
  });
});
