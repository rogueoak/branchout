import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { DifficultyRange } from './DifficultyRange';

/** Stateful harness so the controlled sliders reflect changes as a user drags. */
function Harness({ initialMin = 4, initialMax = 6 }: { initialMin?: number; initialMax?: number }) {
  const [range, setRange] = useState({ min: initialMin, max: initialMax });
  return (
    <DifficultyRange
      min={range.min}
      max={range.max}
      onChange={(min, max) => setRange({ min, max })}
    />
  );
}

describe('DifficultyRange', () => {
  it('renders the two thumbs and a readout of the current range', () => {
    render(<Harness />);
    expect((screen.getByLabelText('Easiest (minimum)') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Hardest (maximum)') as HTMLInputElement).value).toBe('6');
    expect(screen.getByText('4 to 6 (Medium)')).toBeDefined();
  });

  it('moves the floor within the range', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Easiest (minimum)'), { target: { value: '5' } });
    expect(screen.getByText('5 to 6 (Medium)')).toBeDefined();
  });

  it('names a cross-band range by both ends', () => {
    render(<Harness initialMin={2} initialMax={9} />);
    expect(screen.getByText('2 to 9 (Easy to Hard)')).toBeDefined();
  });

  it('clamps the floor so it cannot pass the ceiling', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Easiest (minimum)'), { target: { value: '9' } });
    expect((screen.getByLabelText('Easiest (minimum)') as HTMLInputElement).value).toBe('6');
    expect(screen.getByText('Just 6 (Medium)')).toBeDefined();
  });

  it('clamps the ceiling so it cannot drop below the floor', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Hardest (maximum)'), { target: { value: '2' } });
    expect((screen.getByLabelText('Hardest (maximum)') as HTMLInputElement).value).toBe('4');
    expect(screen.getByText('Just 4 (Medium)')).toBeDefined();
  });
});
