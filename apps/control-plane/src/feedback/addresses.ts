/**
 * The one place the feedback email addresses live (spec 0048), so they are never scattered
 * string literals across the route, the mailer, and the tests. `branchout@rogueoak.com` is now
 * BOTH the verified Resend sender AND the inbox the host's note lands in - a self-notification
 * (from == to) that is guaranteed deliverable because the sender is the Resend account's own
 * verified address. The from now carries the "Branch Out Games" display name in RFC 5322 format
 * over that same verified `branchout@rogueoak.com` sender (the `rogueoak.com` domain is verified
 * in Resend). `rogueoak.com` / the `branchout@` sender must stay verified in Resend for delivery.
 */
export const FEEDBACK_FROM = 'Branch Out Games <branchout@rogueoak.com>';
export const FEEDBACK_TO = 'branchout@rogueoak.com';
