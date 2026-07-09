import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { defaultTriviaConfig, type TriviaHostConfig } from '../../lib/trivia-config';
import { HostConfigPanel } from './HostConfigPanel';

/** A stateful harness so the controlled inputs update as a user types. */
function Harness({
  initial = defaultTriviaConfig(),
  hasViewer = true,
  hostCanSelfFix = false,
  serverReason = null,
  onStart = () => {},
}: {
  initial?: TriviaHostConfig;
  hasViewer?: boolean;
  hostCanSelfFix?: boolean;
  serverReason?: string | null;
  onStart?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <HostConfigPanel
      value={value}
      onChange={setValue}
      onStart={onStart}
      hasViewer={hasViewer}
      hostCanSelfFix={hostCanSelfFix}
      starting={false}
      serverReason={serverReason}
    />
  );
}

describe('HostConfigPanel', () => {
  it('offers the eight categories plus Random and the range defaults', () => {
    render(<Harness />);
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual([
      'Nature',
      'Food',
      'Animals',
      'Science',
      'People',
      'Places',
      'Things',
      'History',
      'Random',
    ]);
    expect((screen.getByLabelText('Rounds') as HTMLInputElement).value).toBe('10');
    // The difficulty range defaults to 4-6 across the two slider thumbs.
    expect((screen.getByLabelText('Easiest (minimum)') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Hardest (maximum)') as HTMLInputElement).value).toBe('6');
    expect(screen.getByText('4 to 6 (Medium)')).toBeDefined();
  });

  it('blocks start with a stated reason until a viewer is present', () => {
    render(<Harness hasViewer={false} />);
    expect((screen.getByRole('button', { name: 'Start game' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/Waiting for a viewer/)).toBeDefined();
  });

  it('points a remote host that is the only viewer-capable device at its own toggle', () => {
    render(<Harness hasViewer={false} hostCanSelfFix />);
    // Instead of "wait for a viewer", the copy tells the host how to fix the block itself.
    expect(screen.getByText(/Switch yourself to Interactive/)).toBeDefined();
    expect(screen.queryByText(/Waiting for a viewer/)).toBeNull();
  });

  it('shows a field error and blocks start when rounds are out of range', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Rounds'), { target: { value: '200' } });
    expect(screen.getByText(/Rounds must be a whole number from 1 to 100/)).toBeDefined();
    expect((screen.getByRole('button', { name: 'Start game' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('clamps the range thumbs so the minimum never passes the maximum', () => {
    render(<Harness />);
    const min = screen.getByLabelText('Easiest (minimum)') as HTMLInputElement;
    // Drag the floor up past the ceiling (6); it should stop at the ceiling, not invert the range.
    fireEvent.change(min, { target: { value: '9' } });
    expect(min.value).toBe('6');
    expect(screen.getByText('Just 6 (Medium)')).toBeDefined();
  });

  it('surfaces the difficulty error for an inverted initial range (defensive)', () => {
    // The sliders clamp, so a user cannot reach this, but a bad incoming config must still block.
    render(<Harness initial={{ ...defaultTriviaConfig(), difficultyMin: 8, difficultyMax: 4 }} />);
    expect(screen.getByText(/Difficulty minimum cannot be above the maximum/)).toBeDefined();
    expect((screen.getByRole('button', { name: 'Start game' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('enables start and fires onStart when a viewer is present and config is valid', () => {
    const onStart = vi.fn();
    render(<Harness onStart={onStart} />);
    const button = screen.getByRole('button', { name: 'Start game' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('surfaces a server refusal reason (e.g. affordability) below the button', () => {
    render(<Harness serverReason="Not enough credits for 10 rounds." />);
    expect(screen.getByText('Not enough credits for 10 rounds.')).toBeDefined();
  });
});
