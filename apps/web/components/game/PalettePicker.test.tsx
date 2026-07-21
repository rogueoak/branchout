import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PLAYER_PALETTES } from '@branchout/protocol';
import { PalettePicker } from './PalettePicker';

describe('PalettePicker (spec 0063)', () => {
  it('renders one option per palette', () => {
    render(<PalettePicker claimedBy={{}} onClaim={() => {}} />);
    const options = screen.getByRole('group', { name: /choose your palette/i });
    expect(options.querySelectorAll('button')).toHaveLength(PLAYER_PALETTES.length);
  });

  it('marks the local claim, disables palettes taken by others, and claims a free one', () => {
    const onClaim = vi.fn();
    render(
      <PalettePicker
        myPaletteId="ember"
        claimedBy={{ ember: 'Me', rose: 'Bo' }}
        onClaim={onClaim}
      />,
    );
    // Mine is pressed and enabled.
    const mine = screen.getByRole('button', { name: /ember palette - yours/i });
    expect(mine.getAttribute('aria-pressed')).toBe('true');
    // Taken-by-other is disabled and names the holder.
    const taken = screen.getByRole('button', { name: /rose palette - taken by bo/i });
    expect(taken).toHaveProperty('disabled', true);
    fireEvent.click(taken);
    expect(onClaim).not.toHaveBeenCalled();
    // A free one is claimable.
    fireEvent.click(screen.getByRole('button', { name: /grape palette - free/i }));
    expect(onClaim).toHaveBeenCalledWith('grape');
  });

  it('disables every claim when disabled', () => {
    const onClaim = vi.fn();
    render(<PalettePicker claimedBy={{}} onClaim={onClaim} disabled />);
    fireEvent.click(screen.getByRole('button', { name: /ember palette - free/i }));
    expect(onClaim).not.toHaveBeenCalled();
  });
});
