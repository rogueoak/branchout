import type { FeedbackContext } from './types';

/**
 * Feedback email rendering (spec 0048). Pure functions that turn a submitted note + its context into
 * the plain-text body (the always-there fallback) and a styled, mobile-first HTML body modelled on
 * the brand welcome email (dark card, gradient strip, Figtree wordmark). Kept separate from the route
 * so the escaping and layout are unit-testable without standing up Fastify.
 *
 * SECURITY: every value that originates from the browser - the message, the capped context strings -
 * and every account-derived value (gamer tag, email) is untrusted, so `renderFeedbackHtml` escapes
 * them before interpolation. The plain-text body needs no escaping.
 */

/** Who sent the note, so the recipient can reach back out. Email is absent for an anonymous sender. */
export interface FeedbackSubmitter {
  /** The submitter's gamer tag (canonical account tag, or the session display name as a fallback). */
  gamerTag: string;
  /** The submitter's account email, when they are signed in to an account. */
  email?: string;
}

export interface FeedbackRenderInput {
  message: string;
  context: FeedbackContext;
  /** ISO timestamp the server received the note (the fallback when the browser stamped none). */
  receivedAt: string;
  submitter: FeedbackSubmitter;
  /** The friendly game name for the heading/subject, e.g. "Teeter Tower". Absent when no game id. */
  gameTitle?: string;
}

/**
 * Turn a game plugin id/slug into a friendly title, e.g. `teeter-tower` -> `Teeter Tower`. Returns
 * undefined when there is no game id, so the caller can fall back (subject/heading) without a game.
 */
export function humanizeGameId(id?: string): string | undefined {
  const slug = id?.trim();
  if (!slug) {
    return undefined;
  }
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Escape the five HTML-significant characters so untrusted text cannot break out into markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A context value or the `(none)` placeholder the recipient sees when the browser sent nothing. */
function orNone(value?: string): string {
  return value && value.length > 0 ? value : '(none)';
}

/** yes / no / (unknown) for the host flag. */
function hostLabel(isHost?: boolean): string {
  return isHost === true ? 'yes' : isHost === false ? 'no' : '(unknown)';
}

/** The browser-stamped submit time, or the server receive time when the browser sent none/blank. */
function submittedAt(context: FeedbackContext, receivedAt: string): string {
  return context.at && context.at.length > 0 ? context.at : receivedAt;
}

/**
 * The plain-text body: the message, who sent it (gamer tag + email so the recipient can reply), then
 * the context needed to act. This is the always-delivered fallback for clients that drop the HTML.
 */
export function renderFeedbackText(input: FeedbackRenderInput): string {
  const { message, context, receivedAt, submitter } = input;
  const from = submitter.email ? `${submitter.gamerTag} <${submitter.email}>` : submitter.gamerTag;
  const lines = [
    message.trim(),
    '',
    '--- context ---',
    `from: ${from}`,
    `room code: ${orNone(context.code)}`,
    `game: ${orNone(context.game)}`,
    `phase: ${orNone(context.phase)}`,
    `host: ${hostLabel(context.isHost)}`,
    `submitted at: ${submittedAt(context, receivedAt)}`,
  ];
  return lines.join('\n');
}

/* ---------------------------------------------------------------- shared brand tokens (email-safe) */

const FONT =
  "'Figtree',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** One context row in the details table. */
function contextRow(label: string, value: string): string {
  return `
              <tr>
                <td style="padding:6px 0; font-family:${FONT}; font-size:13px; line-height:20px; color:#9c98ae; width:120px; vertical-align:top;">${escapeHtml(
                  label,
                )}</td>
                <td style="padding:6px 0; font-family:${FONT}; font-size:14px; line-height:20px; color:#e6e4ee; vertical-align:top;">${escapeHtml(
                  value,
                )}</td>
              </tr>`;
}

/**
 * The styled, mobile-first HTML body. Dark brand card + gradient strip + wordmark header, a quoted
 * message block, a "reach out" panel with the sender's gamer tag and a mailto email, and the acting
 * context as a compact table. Outlook-safe (tables, inline styles, MSO container), and every
 * untrusted value is escaped.
 */
export function renderFeedbackHtml(input: FeedbackRenderInput): string {
  const { message, context, receivedAt, submitter, gameTitle } = input;
  const heading = gameTitle ? `Feedback on ${escapeHtml(gameTitle)}` : 'New player feedback';
  const messageHtml = escapeHtml(message.trim()).replace(/\r?\n/g, '<br />');
  const tag = escapeHtml(submitter.gamerTag);
  const email = submitter.email ? escapeHtml(submitter.email) : undefined;

  // The reach-out panel: gamer tag always, plus a mailto when we have an account email.
  const reachOut = email
    ? `
                    <div style="font-family:${FONT}; font-size:14px; line-height:22px; color:#cbc8d8;">
                      <span style="color:#9c98ae;">Gamer tag</span> &nbsp;<strong style="color:#f7f6fa;">${tag}</strong>
                    </div>
                    <div style="padding-top:6px; font-family:${FONT}; font-size:14px; line-height:22px; color:#cbc8d8;">
                      <span style="color:#9c98ae;">Email</span> &nbsp;<a href="mailto:${email}" style="color:#a78bfa; font-weight:600;">${email}</a>
                    </div>`
    : `
                    <div style="font-family:${FONT}; font-size:14px; line-height:22px; color:#cbc8d8;">
                      <span style="color:#9c98ae;">Gamer tag</span> &nbsp;<strong style="color:#f7f6fa;">${tag}</strong>
                    </div>
                    <div style="padding-top:6px; font-family:${FONT}; font-size:13px; line-height:20px; color:#6e6a80;">
                      No account email on file (anonymous player).
                    </div>`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="dark light" />
  <meta name="supported-color-schemes" content="dark light" />
  <title>Branch Out Games feedback</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <!--[if !mso]><!-->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <!--<![endif]-->
  <style type="text/css">
    html, body { margin: 0 !important; padding: 0 !important; height: 100% !important; width: 100% !important; }
    * { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt !important; mso-table-rspace: 0pt !important; border-collapse: collapse !important; }
    a { text-decoration: none; }
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; }
      .p-fluid { padding-left: 22px !important; padding-right: 22px !important; }
      .p-fluid-header { padding: 28px 22px !important; }
      .p-fluid-footer { padding: 26px 22px !important; }
    }
    @media (prefers-color-scheme: light) { body, .bg-page { background-color: #120f1b !important; } }
  </style>
</head>
<body style="margin:0; padding:0; width:100%; background-color:#120f1b;">
  <div style="display:none; overflow:hidden; line-height:1px; opacity:0; max-height:0; max-width:0; mso-hide:all; font-size:1px; color:#120f1b;">
    New feedback from ${tag}${email ? ` (${email})` : ''}. &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>
  <table role="presentation" class="bg-page" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#120f1b;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <!--[if mso]><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" width="600"><tr><td><![endif]-->
        <table role="presentation" class="email-container" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px; max-width:600px; margin:0 auto;">

          <tr>
            <td bgcolor="#7c3aed" style="height:6px; line-height:6px; font-size:6px; background-color:#7c3aed; background-image:linear-gradient(90deg,#fbbf24 0%,#ec4899 50%,#7c3aed 100%); border-radius:16px 16px 0 0;">&nbsp;</td>
          </tr>

          <tr>
            <td class="p-fluid-header" align="center" bgcolor="#1b1826" style="background-color:#1b1826; padding:32px 40px 24px; border-left:1px solid #2a2738; border-right:1px solid #2a2738;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                <tr>
                  <td valign="middle" style="padding-right:11px;">
                    <img src="https://branchout.games/assets/brand-icon.png" width="40" height="40" alt="" style="display:block; width:40px; height:40px; border-radius:9px;" />
                  </td>
                  <td valign="middle" style="font-family:${FONT}; font-size:26px; font-weight:800; letter-spacing:-0.5px; line-height:1; color:#f7f6fa; white-space:nowrap;">
                    Branch Out<span style="display:inline-block; margin-left:5px; font-size:12px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#a78bfa; vertical-align:3px; transform:rotate(-6deg);">games</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="p-fluid" bgcolor="#1b1826" style="background-color:#1b1826; padding:8px 40px 36px; border-left:1px solid #2a2738; border-right:1px solid #2a2738;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">

                <tr>
                  <td style="padding-top:20px; font-family:${FONT}; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#fde047;">
                    New player feedback
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:8px; font-family:${FONT}; font-size:26px; line-height:33px; font-weight:800; color:#f7f6fa;">
                    ${heading}
                  </td>
                </tr>

                <tr>
                  <td style="padding-top:22px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#221e30" style="background-color:#221e30; border-radius:12px; border-left:3px solid #7c3aed;">
                      <tr>
                        <td style="padding:18px 20px; font-family:${FONT}; font-size:16px; line-height:26px; color:#e6e4ee;">
                          ${messageHtml}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding-top:22px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#2a2738" style="background-color:#2a2738; border-radius:12px;">
                      <tr>
                        <td style="padding:18px 20px;">
                          <div style="font-family:${FONT}; font-size:12px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#9c98ae; padding-bottom:10px;">
                            Reach out to the player
                          </div>
                          ${reachOut}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding-top:26px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #2a2738;">
                      <tr>
                        <td style="padding-top:14px; font-family:${FONT}; font-size:12px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#9c98ae;">
                          Context
                        </td>
                      </tr>
                    </table>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${contextRow(
                      'Room code',
                      orNone(context.code),
                    )}${contextRow('Game', orNone(context.game))}${contextRow(
                      'Phase',
                      orNone(context.phase),
                    )}${contextRow('Host', hostLabel(context.isHost))}${contextRow(
                      'Submitted at',
                      submittedAt(context, receivedAt),
                    )}
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <tr>
            <td class="p-fluid-footer" bgcolor="#161320" style="background-color:#161320; padding:28px 40px; border:1px solid #2a2738; border-top:0; border-radius:0 0 16px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="font-family:${FONT}; font-size:16px; font-weight:800; letter-spacing:-0.3px; line-height:1; color:#f7f6fa; white-space:nowrap;">
                    Branch Out<span style="display:inline-block; margin-left:4px; font-size:10px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:#a78bfa; vertical-align:2px; transform:rotate(-6deg);">games</span>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top:6px; font-family:${FONT}; font-size:13px; line-height:20px; color:#6e6a80;">
                    Sent by the in-game feedback button &mdash; where game night grows.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}
