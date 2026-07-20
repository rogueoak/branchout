import { describe, expect, it } from 'vitest';
import { humanizeGameId, renderFeedbackHtml, renderFeedbackText } from './render';

const base = {
  message: 'The drop button is hard to reach.',
  context: {
    code: 'ABC12',
    game: 'teeter-tower',
    phase: 'collecting',
    isHost: true,
    at: '2026-07-14T12:00:00.000Z',
  },
  receivedAt: '2026-07-14T12:00:01.000Z',
  submitter: { gamerTag: 'CoolCat', email: 'player@example.com' },
  gameTitle: 'Teeter Tower',
};

describe('humanizeGameId', () => {
  it('title-cases a slug into a friendly game name', () => {
    expect(humanizeGameId('teeter-tower')).toBe('Teeter Tower');
    expect(humanizeGameId('lone-leaf')).toBe('Lone Leaf');
    expect(humanizeGameId('liar-liar')).toBe('Liar Liar');
  });

  it('returns undefined for a missing or blank id', () => {
    expect(humanizeGameId(undefined)).toBeUndefined();
    expect(humanizeGameId('')).toBeUndefined();
    expect(humanizeGameId('   ')).toBeUndefined();
  });
});

describe('renderFeedbackText', () => {
  it('names the submitter with gamer tag + email and lists every context field', () => {
    const text = renderFeedbackText(base);
    expect(text).toContain('The drop button is hard to reach.');
    expect(text).toContain('from: CoolCat <player@example.com>');
    expect(text).toContain('room code: ABC12');
    expect(text).toContain('game: teeter-tower');
    expect(text).toContain('phase: collecting');
    expect(text).toContain('host: yes');
    expect(text).toContain('submitted at: 2026-07-14T12:00:00.000Z');
  });

  it('omits the email from the from-line for an anonymous submitter, and shows (none)/(unknown)', () => {
    const text = renderFeedbackText({
      ...base,
      context: {},
      submitter: { gamerTag: 'GuestFox' },
    });
    expect(text).toContain('from: GuestFox');
    expect(text).not.toContain('<');
    expect(text).toContain('room code: (none)');
    expect(text).toContain('host: (unknown)');
    // Falls back to the server receive time when the browser stamped none.
    expect(text).toContain('submitted at: 2026-07-14T12:00:01.000Z');
  });

  it('falls back to the receive time when the browser stamped a blank at', () => {
    // `context.at` is a capped string, so an empty string reaches here; it must not render blank.
    const text = renderFeedbackText({ ...base, context: { ...base.context, at: '' } });
    expect(text).toContain('submitted at: 2026-07-14T12:00:01.000Z');
    expect(text).not.toContain('submitted at: \n');
    expect(text.endsWith('submitted at: 2026-07-14T12:00:01.000Z')).toBe(true);
  });
});

describe('renderFeedbackHtml', () => {
  it('renders the heading, message, gamer tag, and a mailto link', () => {
    const html = renderFeedbackHtml(base);
    expect(html).toContain('Feedback on Teeter Tower');
    expect(html).toContain('The drop button is hard to reach.');
    expect(html).toContain('CoolCat');
    expect(html).toContain('mailto:player@example.com');
    expect(html).toContain('<!DOCTYPE html');
  });

  it('escapes untrusted values so a hostile message cannot inject markup', () => {
    const html = renderFeedbackHtml({
      ...base,
      message: '<script>alert(1)</script> & "quotes"',
      submitter: { gamerTag: '<b>Tag</b>', email: 'a@b.com' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;b&gt;Tag&lt;/b&gt;');
  });

  it('converts message newlines to <br> for the HTML body', () => {
    const html = renderFeedbackHtml({ ...base, message: 'line one\nline two' });
    expect(html).toContain('line one<br />line two');
  });

  it('shows the anonymous fallback when there is no account email', () => {
    const html = renderFeedbackHtml({ ...base, submitter: { gamerTag: 'GuestFox' } });
    expect(html).toContain('GuestFox');
    expect(html).not.toContain('mailto:');
    expect(html).toContain('anonymous player');
  });

  it('uses the generic heading when there is no game title', () => {
    const html = renderFeedbackHtml({
      message: base.message,
      context: base.context,
      receivedAt: base.receivedAt,
      submitter: base.submitter,
    });
    expect(html).not.toContain('Feedback on');
    // The heading and eyebrow both read as the generic label without a game.
    expect(html).toContain('New player feedback');
  });
});
