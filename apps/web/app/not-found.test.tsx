import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import NotFound from './not-found';

describe('NotFound (404 page)', () => {
  it('shows the friendly lost message and a button link home', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { name: /whoops, looks like you are lost/i })).toBeDefined();
    const home = screen.getByRole('link', { name: /go home/i });
    expect(home.getAttribute('href')).toBe('/');
  });
});
