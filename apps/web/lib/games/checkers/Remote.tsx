'use client';

// Checkers is a SINGLE interactive surface (spec 0055): its Viewer canvas IS the whole game and the
// active player taps directly on it, so the shell (GameStage) never renders a separate remote for a
// single-surface game. This stays a null no-op only to keep the registry's GameUiModule shape valid.

import type { ComponentType } from 'react';
import type { GameRemoteProps } from '../registry';

export const CheckersRemote: ComponentType<GameRemoteProps> = function CheckersRemote() {
  return null;
};
