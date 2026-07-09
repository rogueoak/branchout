import { describe, expect, it } from 'vitest';
import { GameRegistry, UnknownGameError } from './registry';
import { stubGame, STUB_GAME_ID } from '@branchout/game-sdk/testing';

describe('GameRegistry', () => {
  it('resolves a registered game by id', () => {
    const registry = new GameRegistry([stubGame]);
    expect(registry.resolve(STUB_GAME_ID)).toBe(stubGame);
    expect(registry.has(STUB_GAME_ID)).toBe(true);
    expect(registry.ids()).toEqual([STUB_GAME_ID]);
  });

  it('throws UnknownGameError for an unregistered id', () => {
    const registry = new GameRegistry([stubGame]);
    expect(() => registry.resolve('missing')).toThrow(UnknownGameError);
    expect(registry.has('missing')).toBe(false);
  });

  it('rejects a duplicate registration', () => {
    const registry = new GameRegistry([stubGame]);
    expect(() => registry.register(stubGame)).toThrow(/already registered/);
  });

  it('registers a game added after construction', () => {
    const registry = new GameRegistry();
    expect(registry.has(STUB_GAME_ID)).toBe(false);
    registry.register(stubGame);
    expect(registry.resolve(STUB_GAME_ID)).toBe(stubGame);
  });
});
