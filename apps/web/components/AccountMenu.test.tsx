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

  it('Log out revokes the session and routes home', async () => {
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith('/');
  });
});
