import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchProfile = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/profile-api', () => ({ fetchProfile }));

import ProfilePage from './page';

function renderPage(gamerTag = 'AdaL') {
  // The page is an async Server Component; await it to get the element tree, then render.
  return ProfilePage({ params: Promise.resolve({ gamerTag }) }).then((el) => render(el));
}

describe('public profile page', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders a public profile with stars and the recent-games timeline', async () => {
    fetchProfile.mockResolvedValue({
      gamerTag: 'AdaL',
      totalStars: 5,
      visibility: 'public',
      restricted: false,
      nickname: 'Ada',
      avatar: 'fox',
      recentPlays: [{ game: 'trivia', rank: 1, stars: 3, playedAt: '2026-07-10T00:00:00.000Z' }],
    });
    await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Ada' })).toBeDefined();
    expect(screen.getByText('5 stars')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Recent games' })).toBeDefined();
    expect(screen.getByText('Trivia')).toBeDefined();
    expect(screen.getByText('Placed #1')).toBeDefined();
  });

  it('hides the detail for a restricted (private) profile', async () => {
    fetchProfile.mockResolvedValue({
      gamerTag: 'AdaL',
      totalStars: 5,
      visibility: 'private',
      restricted: true,
    });
    await renderPage();
    // Gamer tag + stars still show...
    expect(screen.getByText('5 stars')).toBeDefined();
    expect(screen.getByText(/This profile is private/)).toBeDefined();
    // ...but no recent-games section.
    expect(screen.queryByRole('heading', { name: 'Recent games' })).toBeNull();
  });

  it('shows the friends-only message for a friends-only restricted profile', async () => {
    fetchProfile.mockResolvedValue({
      gamerTag: 'AdaL',
      totalStars: 2,
      visibility: 'friends-only',
      restricted: true,
    });
    await renderPage();
    expect(screen.getByText('2 stars')).toBeDefined();
    expect(screen.getByText(/This profile is friends-only/)).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Recent games' })).toBeNull();
  });

  it('shows an empty state when a public profile has played no games', async () => {
    fetchProfile.mockResolvedValue({
      gamerTag: 'AdaL',
      totalStars: 0,
      visibility: 'public',
      restricted: false,
      nickname: 'Ada',
      avatar: 'fox',
      recentPlays: [],
    });
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Recent games' })).toBeDefined();
    expect(screen.getByText('No games played yet.')).toBeDefined();
  });

  it('shows a not-found message for an unknown tag', async () => {
    fetchProfile.mockResolvedValue(null);
    await renderPage('ghost');
    expect(screen.getByRole('heading', { name: 'Player not found' })).toBeDefined();
  });
});
