import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The feature page is an async Server Component. To render it we control the two request-scoped
// reads it makes: the surface (getSurface reads the `Host` header via next/headers) and the viewer
// (getViewer). A sentinel `notFound()` makes the apex-404 of an insider slug observable.

const hostHolder: { value: string | null } = { value: 'branchout.games' };
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'host' ? hostHolder.value : null) }),
  cookies: async () => ({ get: () => undefined }),
}));

class NotFoundError extends Error {}
vi.mock('next/navigation', () => ({
  // The shared top nav's account menu uses useRouter under jsdom.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new NotFoundError('NEXT_NOT_FOUND');
  },
}));

const viewerHolder: { value: { signedIn: boolean; insider?: boolean } } = {
  value: { signedIn: false },
};
vi.mock('../../../lib/session', () => ({
  getViewer: async () => viewerHolder.value,
}));

import Page, { generateMetadata } from './page';

const APEX = 'branchout.games';
const INSIDER = 'insider.branchout.games';

async function renderPage(slug: string, host = APEX) {
  hostHolder.value = host;
  const el = await Page({ params: Promise.resolve({ slug }) });
  return render(el);
}

async function metadataFor(slug: string, host = APEX) {
  hostHolder.value = host;
  return generateMetadata({ params: Promise.resolve({ slug }) });
}

describe('game feature page (spec 0030 hero-first rework)', () => {
  afterEach(() => {
    hostHolder.value = APEX;
    viewerHolder.value = { signedIn: false };
    vi.clearAllMocks();
  });

  it('renders hero art, the icon + title, and the badge + tags row for a public game', async () => {
    const { container } = await renderPage('trivia');
    // Hero art: the wide 16:9 hero SVG (viewBox 0 0 800 450) is inlined at the top, not the mark.
    expect(container.innerHTML).toContain('viewBox="0 0 800 450"');
    // Icon (the 512x512 mark) + the title inline beneath the hero.
    expect(container.innerHTML).toContain('viewBox="0 0 512 512"');
    expect(screen.getByRole('heading', { level: 1, name: 'Trivia' }).tagName).toBe('H1');
    // The badge + tags row: the catalog badge plus the library tag chips (matches the card). "Big
    // group" is a trivia tag label unique to the row (the title/description carry no such text).
    expect(screen.getByText('Featured')).toBeTruthy();
    expect(screen.getByText('Big group')).toBeTruthy();
    // The rules section renders (objective + headed sections, spec 0051).
    expect(screen.getByRole('heading', { name: /^rules$/i })).toBeTruthy();
    // The closing "Ready to play" CTA starts the game.
    expect(screen.getByRole('heading', { name: /ready to play trivia\?/i })).toBeTruthy();
    const starts = screen.getAllByRole('link', { name: 'Start a game' });
    expect(starts.length).toBeGreaterThan(0);
    // Anonymous visitor: the CTA routes through signup, preserving the game.
    expect(starts[0].getAttribute('href')).toBe('/signup?next=%2Frooms%3Fgame%3Dtrivia');
  });

  it('drops the removed "How to play" and "Categories" sections', async () => {
    await renderPage('trivia');
    expect(screen.queryByRole('heading', { name: /how to play/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^categories$/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^topics$/i })).toBeNull();
  });

  it('sends a signed-in visitor straight to play from the CTA', async () => {
    viewerHolder.value = { signedIn: true };
    await renderPage('trivia');
    const starts = screen.getAllByRole('link', { name: 'Start a game' });
    expect(starts[0].getAttribute('href')).toBe('/rooms?game=trivia');
  });

  it('emits JSON-LD VideoGame structured data on a public page', async () => {
    const { container } = await renderPage('trivia');
    const ld = container.querySelector('script[type="application/ld+json"]');
    expect(ld).not.toBeNull();
    expect(JSON.parse(ld!.textContent ?? '{}')['@type']).toBe('VideoGame');
  });
});

describe('game feature page surface-aware insider gating (spec 0030)', () => {
  afterEach(() => {
    hostHolder.value = APEX;
    viewerHolder.value = { signedIn: false };
  });

  it('404s an insider game on the apex (it must not exist on the public site)', async () => {
    await expect(renderPage('lone-leaf', APEX)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('renders an insider game on the insider surface, with the Insiders badge and no JSON-LD', async () => {
    viewerHolder.value = { signedIn: true, insider: true };
    const { container } = await renderPage('lone-leaf', INSIDER);
    expect(screen.getByRole('heading', { level: 1, name: 'Lone Leaf' }).tagName).toBe('H1');
    // Hero art present; the "Insiders" badge marks it; the rules section renders.
    expect(container.innerHTML).toContain('viewBox="0 0 800 450"');
    expect(screen.getByText('Insiders')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^rules$/i })).toBeTruthy();
    // No SEO structured data on an insider (gated, noindex) page.
    expect(container.querySelector('script[type="application/ld+json"]')).toBeNull();
  });

  it('still 404s an unknown slug on both surfaces', async () => {
    await expect(renderPage('does-not-exist', APEX)).rejects.toBeInstanceOf(NotFoundError);
    await expect(renderPage('does-not-exist', INSIDER)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('game feature page metadata (spec 0030)', () => {
  afterEach(() => {
    hostHolder.value = APEX;
  });

  it('gives a public game a full SEO block (title, description, canonical)', async () => {
    const meta = await metadataFor('trivia', APEX);
    expect(String(meta.title)).toContain('Trivia');
    expect(String(meta.description)).toContain('Trivia');
    expect(meta.alternates?.canonical).toMatch(/\/games\/trivia$/);
    expect(meta.robots).toBeUndefined();
  });

  it('marks an insider page noindex with no canonical (SEO only where public)', async () => {
    const meta = await metadataFor('lone-leaf', INSIDER);
    expect(String(meta.title)).toContain('Lone Leaf');
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates?.canonical).toBeUndefined();
  });

  it('returns a not-found title for an insider slug on the apex and for an unknown slug', async () => {
    expect(String((await metadataFor('lone-leaf', APEX)).title)).toContain('not found');
    expect(String((await metadataFor('nope', APEX)).title)).toContain('not found');
  });
});
