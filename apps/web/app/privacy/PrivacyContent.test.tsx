import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED } from '../../lib/legal';
import { PrivacyContent } from './PrivacyContent';

// The page.tsx server component is a thin viewer reader that wraps this with the nav + footer, so
// testing the content directly (no next/headers mock) covers the policy's observable surface.
describe('PrivacyContent', () => {
  it('renders the policy heading and the last-updated date from the shared constant', () => {
    render(<PrivacyContent />);
    screen.getByRole('heading', { level: 1, name: /privacy policy/i });
    expect(screen.queryByText(new RegExp(LEGAL_LAST_UPDATED))).not.toBeNull();
  });

  it('describes first-party analytics (not third-party trackers)', () => {
    render(<PrivacyContent />);
    screen.getByRole('heading', { name: /analytics/i });
    // "first-party" and "PostHog" both appear in more than one section; assert presence.
    expect(screen.getAllByText(/first-party/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/proxied through our own domain/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/PostHog/).length).toBeGreaterThan(0);
  });

  it('states what an account stores', () => {
    render(<PrivacyContent />);
    screen.getByRole('heading', { name: /accounts and what we store/i });
    expect(screen.getAllByText(/email address/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/gamer tag/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/avatar/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/stars/i).length).toBeGreaterThan(0);
  });

  it('covers anonymous play, IP/logs, children, rights, changes, and contact', () => {
    render(<PrivacyContent />);
    screen.getByRole('heading', { name: /playing without an account/i });
    screen.getByRole('heading', { name: /ip addresses and server logs/i });
    screen.getByRole('heading', { name: /children/i });
    screen.getByRole('heading', { name: /your choices and rights/i });
    screen.getByRole('heading', { name: /changes to this policy/i });
    screen.getByRole('heading', { name: /^contact$/i });
  });

  it('exposes the contact email from the shared constant', () => {
    render(<PrivacyContent />);
    const links = screen.getAllByRole('link', { name: LEGAL_CONTACT_EMAIL });
    expect(links[0]).toHaveProperty('href', `mailto:${LEGAL_CONTACT_EMAIL}`);
  });
});
