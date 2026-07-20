import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLEAR_ALLOWANCE, DrawCanvas, UNDO_ALLOWANCE } from './DrawCanvas';
import type { Sketch } from './strokes';

// canopy's ResponsiveDialog (the Clear confirm) reads useIsMobile() -> matchMedia, which jsdom does
// not implement. Stub it so the desktop (modal) form mounts deterministically. Radix portals into
// document.body, which Testing Library queries fine.
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});

const drawn: Sketch = { strokes: [{ color: '#0d0a15', points: [0, 0, 100, 100] }] };
function noop() {}

function renderCanvas(props: Partial<React.ComponentProps<typeof DrawCanvas>> = {}) {
  return render(
    <DrawCanvas
      sketch={drawn}
      onChange={noop}
      undosRemaining={UNDO_ALLOWANCE}
      clearsRemaining={CLEAR_ALLOWANCE}
      onUndo={noop}
      onClear={noop}
      {...props}
    />,
  );
}

describe('DrawCanvas allowances', () => {
  it('shows the remaining undo/clear counts and the whole-game scope copy', () => {
    renderCanvas();
    expect(screen.getByRole('button', { name: `Undo (${UNDO_ALLOWANCE} left)` })).toBeDefined();
    expect(screen.getByRole('button', { name: `Clear (${CLEAR_ALLOWANCE} left)` })).toBeDefined();
    // The "whole game" scope is spelled out so a player knows the allowance is not per round.
    expect(screen.getByText(/for the whole game/i)).toBeDefined();
  });

  it('spends an undo: removes the last stroke and reports the spend to the parent', () => {
    const onChange = vi.fn();
    const onUndo = vi.fn();
    renderCanvas({ onChange, onUndo, undosRemaining: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo (2 left)' }));
    expect(onChange).toHaveBeenCalledWith({ strokes: [] });
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('disables Undo when the per-game allowance is exhausted', () => {
    const onUndo = vi.fn();
    renderCanvas({ onUndo, undosRemaining: 0 });
    const undo = screen.getByRole('button', { name: 'Undo (0 left)' });
    expect(undo).toHaveProperty('disabled', true);
    fireEvent.click(undo);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('disables Undo when there is nothing drawn yet', () => {
    renderCanvas({ sketch: { strokes: [] } });
    expect(screen.getByRole('button', { name: 'Undo (3 left)' })).toHaveProperty('disabled', true);
  });

  it('confirms before Clear, then wipes the sketch and reports the spend', async () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    renderCanvas({ onChange, onClear });
    // Clear does not fire immediately - it opens a confirm dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Clear (1 left)' }));
    expect(onChange).not.toHaveBeenCalled();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /clear sketch/i }));
    expect(onChange).toHaveBeenCalledWith({ strokes: [] });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('disables Clear when the single clear is spent', () => {
    renderCanvas({ clearsRemaining: 0 });
    expect(screen.getByRole('button', { name: 'Clear (0 left)' })).toHaveProperty('disabled', true);
  });
});
