import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CanopyButton } from './canopy-button';

describe('CanopyButton placeholder', () => {
  it('renders its label as an accessible button', () => {
    render(<CanopyButton>Start a room</CanopyButton>);
    expect(screen.getByRole('button', { name: 'Start a room' })).toBeDefined();
  });
});
