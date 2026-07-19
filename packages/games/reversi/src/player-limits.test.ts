// Guard against silent drift between the TWO independent hardcoded sources of Reversi's player count:
// PLAYER_LIMITS.reversi (protocol - what the web lobby / room-create gate / picker read) and the
// plugin manifest capabilities (what the control-plane enforces). They are declared apart, so this
// cross-assertion fails loudly if one is changed without the other. Reversi is a strict 2-player game.

import { describe, expect, it } from 'vitest';
import { PLAYER_LIMITS } from '@branchout/protocol';
import { reversiPlugin, REVERSI_GAME_ID } from './reversi';

describe('reversi player-count sources agree', () => {
  it('PLAYER_LIMITS matches the plugin capabilities (both exactly 2)', () => {
    const limits = PLAYER_LIMITS[REVERSI_GAME_ID];
    const caps = reversiPlugin.manifest.capabilities;
    expect(limits).toEqual({ min: 2, max: 2 });
    expect(caps).toEqual({ minPlayers: 2, maxPlayers: 2 });
    // The two sources must agree, not just each be "some 2".
    expect(caps?.minPlayers).toBe(limits?.min);
    expect(caps?.maxPlayers).toBe(limits?.max);
  });
});
