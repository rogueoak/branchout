import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Logo } from './Logo';

describe('Logo', () => {
  it('renders a span with role img and correct aria-label', () => {
    const { container } = render(<Logo />);
    const span = container.querySelector('span[role="img"]');
    expect(span).not.toBeNull();
    expect(span?.getAttribute('aria-label')).toContain('Branch out');
  });

  it('renders an SVG element inside the span', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('accepts a className prop', () => {
    const { container } = render(<Logo className="test-class" />);
    const span = container.querySelector('span');
    expect(span?.classList.contains('test-class')).toBe(true);
  });
});
