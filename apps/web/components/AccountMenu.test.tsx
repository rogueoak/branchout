import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const logout = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/account-api', () => ({ logout: () => logout() }));

import { AccountMenu } from './AccountMenu';

function open() {
  render(<AccountMenu gamerTag="CoolCat" nickname="Cat" avatar="sprout" />);
  const trigger = screen.getByRole('button', { name: /account menu for cat/i });
  fireEvent.click(trigger);
  return trigger;
}

describe('AccountMenu', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('is closed until the avatar is clicked (aria-expanded reflects state)', () => {
    render(<AccountMenu gamerTag="CoolCat" nickname="Cat" avatar="sprout" />);
    const trigger = screen.getByRole('button', { name: /account menu for cat/i });
    expect(trigger).toHaveProperty('ariaExpanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveProperty('ariaExpanded', 'true');
    expect(screen.getByRole('menu')).toBeDefined();
  });

  it('opens to Manage account (/account) and Log out', () => {
    open();
    expect(screen.getByRole('menuitem', { name: 'Manage account' })).toHaveProperty(
      'href',
      expect.stringContaining('/account'),
    );
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeDefined();
  });

  it('closes on Escape', () => {
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on an outside pointer press', () => {
    open();
    expect(screen.getByRole('menu')).toBeDefined();
    // A pointerdown outside the menu root closes it (the document-level listener).
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('is a roving-tabindex menu: items are out of the page tab order and Tab closes it', () => {
    open();
    // Menu items carry tabIndex=-1 (focus is managed by arrow keys, not Tab).
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item).toHaveProperty('tabIndex', -1);
    }
    // Tab within the menu closes it (a menu is not part of the page tab sequence).
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Log out revokes the session and routes home', async () => {
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith('/');
  });
});
