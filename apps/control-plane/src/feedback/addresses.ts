/**
 * The one place the feedback email addresses live (spec 0048), so they are never scattered
 * string literals across the route, the mailer, and the tests. `branchout@rogueoak.com` is the
 * sender - `rogueoak.com` must be a verified Resend sending domain for it to deliver (operator
 * follow-up) - and `feedback@rogueoak.com` is the inbox the host's note lands in.
 */
export const FEEDBACK_FROM = 'branchout@rogueoak.com';
export const FEEDBACK_TO = 'feedback@rogueoak.com';
