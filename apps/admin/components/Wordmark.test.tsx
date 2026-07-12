import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Wordmark } from './Wordmark';

describe('Wordmark', () => {
  it('renders a span with role img labelled "Branch Out Games"', () => {
    const { container } = render(<Wordmark />);
    const span = container.querySelector('span[role="img"]');
    expect(span).not.toBeNull();
    expect(span?.getAttribute('aria-label')).toBe('Branch Out Games');
  });

  it('renders the icon mark as an inline SVG', () => {
    const { container } = render(<Wordmark />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders the "Branch Out" name with a smaller "games" flourish', () => {
    const { getByText } = render(<Wordmark />);
    expect(getByText('Branch Out')).toBeDefined();
    expect(getByText('games')).toBeDefined();
  });
});
