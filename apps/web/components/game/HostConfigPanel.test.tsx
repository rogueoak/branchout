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
    expect((screen.getByLabelText('Difficulty') as HTMLInputElement).value).toBe('5');
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

  it('shows a field error when difficulty is out of range', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Difficulty'), { target: { value: '11' } });
    expect(screen.getByText(/Difficulty must be a whole number from 1 to 10/)).toBeDefined();
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
