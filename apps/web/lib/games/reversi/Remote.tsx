'use client';

// Reversi is a SINGLE interactive surface (spec 0054): its Viewer canvas IS the whole game and the
// active player taps directly on it, so the shell (GameStage) never renders a separate remote for a
// single-surface game. This stays a null no-op only to keep the registry's GameUiModule shape valid.

import type { ComponentType } from 'react';
import type { GameRemoteProps } from '../registry';

export const ReversiRemote: ComponentType<GameRemoteProps> = function ReversiRemote() {
  return null;
};
