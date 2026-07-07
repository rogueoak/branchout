import { describe, expect, it } from 'vitest';
import RootLayout, { metadata } from './layout';

// Dark is the default (and only) theme, set via the `dark` class on <html> so both token layers
// flip. This is cross-surface behavior with no other coverage: a dropped class would silently
// regress every page, so guard it here.
describe('RootLayout', () => {
  it('applies the dark theme by default on <html>', () => {
    const tree = RootLayout({ children: null });
    expect(tree.type).toBe('html');
    expect(tree.props.className).toBe('dark');
  });

  it('names the product "Branch Out Games"', () => {
    expect(metadata.title).toBe('Branch Out Games');
    expect(metadata.openGraph?.title).toBe('Branch Out Games');
  });
});
