import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LEGAL_LAST_UPDATED } from '../../lib/legal';
import { TermsContent } from './TermsContent';

// The page.tsx wraps this with the nav + footer; testing the body directly covers the terms'
// observable surface without mocking next/headers.
describe('TermsContent', () => {
  it('renders the terms heading and the last-updated date from the shared constant', () => {
    render(<TermsContent />);
    screen.getByRole('heading', { level: 1, name: /terms of service/i });
    expect(screen.queryByText(new RegExp(LEGAL_LAST_UPDATED))).not.toBeNull();
  });

  it('carries a "not legal advice" note', () => {
    render(<TermsContent />);
    expect(screen.queryByText(/not legal advice/i)).not.toBeNull();
  });

  it('provides the service "as is" with no warranty', () => {
    render(<TermsContent />);
    screen.getByRole('heading', { name: /provided .*as is/i });
    expect(screen.queryByText(/without\s+warranties of any kind/i)).not.toBeNull();
  });

  it('limits liability', () => {
    render(<TermsContent />);
    screen.getByRole('heading', { name: /limitation of liability/i });
  });

  it('says the terms can change at any time and continued use is acceptance', () => {
    render(<TermsContent />);
    screen.getByRole('heading', { name: /changes to these terms/i });
    expect(screen.queryByText(/change these terms at any time/i)).not.toBeNull();
    expect(screen.queryByText(/accept the updated terms/i)).not.toBeNull();
  });

  it('covers acceptance, eligibility, acceptable use, IP, termination, and governing law', () => {
    render(<TermsContent />);
    screen.getByRole('heading', { name: /acceptance/i });
    screen.getByRole('heading', { name: /who can use it/i });
    screen.getByRole('heading', { name: /acceptable use/i });
    // "6. Our content" (the IP/ownership section) - the number disambiguates it from "5. Your
    // content", whose accessible name also contains "our content".
    screen.getByRole('heading', { name: /6\. our content/i });
    screen.getByRole('heading', { name: /suspension and termination/i });
    screen.getByRole('heading', { name: /governing law/i });
  });
});
