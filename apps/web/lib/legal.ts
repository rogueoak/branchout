// Single source for the legal pages' shared values (spec 0031), so the privacy policy, the terms of
// service, and the footer never drift apart. Update the date here whenever either page changes.
//
// NOTE (for the developer): the contact email, operating entity (Rogue Oak), and governing-law
// jurisdiction (Ontario, Canada) are set. A legal review of both pages is still recommended before
// these are relied on.

/** The company that operates Branch Out Games ("we"/"us" in the legal pages). */
export const OPERATING_ENTITY = 'Rogue Oak';

/** The public address for privacy/terms questions and data requests. */
export const LEGAL_CONTACT_EMAIL = 'privacy@rogueoak.com';

/** The "Last updated" date shown on both legal pages. */
export const LEGAL_LAST_UPDATED = 'July 11, 2026';

/** Governing-law jurisdiction for the terms of service. */
export const GOVERNING_LAW = 'the Province of Ontario, Canada';
