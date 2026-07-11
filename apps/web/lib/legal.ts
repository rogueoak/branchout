// Single source for the legal pages' shared values (spec 0031), so the privacy policy, the terms of
// service, and the footer never drift apart. Update the date here whenever either page changes.
//
// NOTE (for the developer): `LEGAL_CONTACT_EMAIL` and `GOVERNING_LAW` are placeholders to confirm -
// point the address at a real inbox and set the jurisdiction/entity before this is relied on.

/** The public address for privacy/terms questions and data requests. */
export const LEGAL_CONTACT_EMAIL = 'privacy@branchout.games';

/** The "Last updated" date shown on both legal pages. */
export const LEGAL_LAST_UPDATED = 'July 11, 2026';

/** Placeholder governing-law jurisdiction for the terms of service. */
export const GOVERNING_LAW = 'the jurisdiction where Branch Out Games is operated';
