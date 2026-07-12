import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminNav } from './AdminNav';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe('AdminNav (spec 0037)', () => {
  it('shows the section links, the signed-in admin, and a log out control', () => {
    render(<AdminNav email="root@rogueoak.com" />);
    expect(screen.getByRole('link', { name: 'Users' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Admins' })).toBeDefined();
    expect(screen.getByText('root@rogueoak.com')).toBeDefined();
    expect(screen.getByRole('button', { name: /log out/i })).toBeDefined();
  });
});
