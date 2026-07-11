import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AVATAR_IDS } from '@branchout/brand/avatar-ids';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('renders the avatar SVG for a known id', () => {
    render(<Avatar avatar={AVATAR_IDS[0]} name="Ada" />);
    const el = screen.getByRole('img', { name: "Ada's avatar" });
    expect(el.querySelector('svg')).not.toBeNull();
  });

  it('falls back to initials for a missing avatar', () => {
    render(<Avatar name="Ada Lovelace" />);
    const el = screen.getByRole('img', { name: "Ada Lovelace's avatar" });
    expect(el.querySelector('svg')).toBeNull();
    expect(el.textContent).toBe('AL');
  });

  it('falls back to initials for an unknown avatar id', () => {
    render(<Avatar avatar="not-a-real-avatar" name="Bo" />);
    const el = screen.getByRole('img', { name: "Bo's avatar" });
    expect(el.querySelector('svg')).toBeNull();
    expect(el.textContent).toBe('BO');
  });
});
