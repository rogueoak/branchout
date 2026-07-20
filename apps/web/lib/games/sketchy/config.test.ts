import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUNDS,
  MAX_ADVANCE_AFTER_SECONDS,
  MAX_ROUNDS,
  MIN_ADVANCE_AFTER_SECONDS,
  ROUND_PRESETS,
  defaultSketchyConfig,
  validateSketchyConfig,
  type SketchyHostConfig,
} from './config';

const base: SketchyHostConfig = defaultSketchyConfig();

describe('defaultSketchyConfig', () => {
  it('defaults to 5 rounds, auto-advance on at a 5s dwell', () => {
    expect(defaultSketchyConfig()).toEqual({
      rounds: 5,
      autoAdvance: true,
      advanceAfterSeconds: 5,
    });
    expect(DEFAULT_ROUNDS).toBe(5);
    expect(validateSketchyConfig(base)).toEqual([]);
  });
});

describe('validateSketchyConfig', () => {
  it('accepts an in-range round count including Marathon (15)', () => {
    expect(validateSketchyConfig({ ...base, rounds: 1 })).toEqual([]);
    expect(validateSketchyConfig({ ...base, rounds: MAX_ROUNDS })).toEqual([]);
  });

  it('rejects an out-of-range or non-integer round count', () => {
    for (const rounds of [0, MAX_ROUNDS + 1, 2.5, Number.NaN]) {
      expect(validateSketchyConfig({ ...base, rounds })).toEqual([
        expect.objectContaining({ field: 'rounds' }),
      ]);
    }
  });

  it('accepts an advance-after on both boundaries (1 and 60)', () => {
    // Both ends of the accept range must pass, so an off-by-one in the bound is caught.
    expect(
      validateSketchyConfig({ ...base, advanceAfterSeconds: MIN_ADVANCE_AFTER_SECONDS }),
    ).toEqual([]);
    expect(
      validateSketchyConfig({ ...base, advanceAfterSeconds: MAX_ADVANCE_AFTER_SECONDS }),
    ).toEqual([]);
  });

  it('rejects an advance-after outside 1-60', () => {
    for (const advanceAfterSeconds of [0, 61, 5.5]) {
      expect(validateSketchyConfig({ ...base, advanceAfterSeconds })).toEqual([
        expect.objectContaining({ field: 'advanceAfter' }),
      ]);
    }
  });
});

describe('presets', () => {
  it('exposes Fast/Standard/Long/Marathon round presets', () => {
    expect(ROUND_PRESETS.map((preset) => [preset.label, preset.value])).toEqual([
      ['Fast', 3],
      ['Standard', 5],
      ['Long', 7],
      ['Marathon', 15],
    ]);
  });

  it('keeps the default inside the Standard preset', () => {
    expect(ROUND_PRESETS.find((preset) => preset.value === DEFAULT_ROUNDS)?.label).toBe('Standard');
  });
});
