/**
 * The one place the feedback email addresses live (spec 0048), so they are never scattered
 * string literals across the route, the mailer, and the tests. `branchout@rogueoak.com` is now
 * BOTH the verified Resend sender AND the inbox the host's note lands in - a self-notification
 * (from == to) that is guaranteed deliverable because the sender is the Resend account's own
 * verified address. `rogueoak.com` / the `branchout@` sender must stay verified in Resend for
 * delivery.
 */
export const FEEDBACK_FROM = 'branchout@rogueoak.com';
export const FEEDBACK_TO = 'branchout@rogueoak.com';
