'use client';

// Teeter Tower is a SINGLE interactive surface (spec 0044): its Viewer canvas IS the whole game, and
// the active player aims + drops directly on it. There is no separate remote controller, so the shell
// (GameStage) never renders this for a single-surface game. It stays a null no-op only to keep the
// registry's GameUiModule shape valid.

import type { ComponentType } from 'react';
import type { GameRemoteProps } from '../registry';

// Typed as the shared remote component so the registry's GameUiModule shape stays valid; it renders
// nothing because a single-surface game never mounts a separate controller.
export const TeeterRemote: ComponentType<GameRemoteProps> = function TeeterRemote() {
  return null;
};
