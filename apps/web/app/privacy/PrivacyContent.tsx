// The privacy policy body (spec 0031). A plain, static component - no client hooks, no session - so
// it renders in a Server Component and is unit-testable on its own (the page wraps it with the nav
// and footer). Plain-language and accurate to what Branch Out actually does today: accounts, rooms,
// and the first-party PostHog analytics being enabled (spec 0032). ASCII-only, Trellis voice.

import { LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED } from '../../lib/legal';

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline-offset-4 hover:underline"
    >
      {children}
    </a>
  );
}

function ContactEmail() {
  return (
    <a
      href={`mailto:${LEGAL_CONTACT_EMAIL}`}
      className="text-primary underline-offset-4 hover:underline"
    >
      {LEGAL_CONTACT_EMAIL}
    </a>
  );
}

export function PrivacyContent() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-h1 font-bold text-text">Privacy Policy</h1>
      <p className="mt-2 text-caption text-text-muted">Last updated: {LEGAL_LAST_UPDATED}</p>

      <p className="mt-6 text-body text-text-muted">
        Branch Out Games is a place to play games with friends. This page explains, in plain
        language, what data we collect when you use it and why. We keep it short because we try to
        collect little.
      </p>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">The short version</h2>
        <p className="mt-3 text-body text-text-muted">
          We do not sell your data. We do not run ads, and we do not share your information with
          advertisers or data brokers. All the data we collect is first-party - it goes to us, not
          to third-party trackers. You can play without an account; an account only saves your
          progress and lets you host.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">Analytics</h2>
        <p className="mt-3 text-body text-text-muted">
          We use PostHog for product analytics - to understand how the site is used (which pages are
          visited, where a flow breaks) so we can make it better - and to report errors and crashes
          so we can fix them.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-body text-text-muted">
          <li>
            It is <strong className="text-text">first-party</strong>: analytics requests are proxied
            through our own domain, not a third-party tracker hostname, and we do not use
            advertising or cross-site tracking cookies.
          </li>
          <li>
            It is <strong className="text-text">cookieless</strong>: PostHog stores a small amount
            of data in your browser&apos;s local storage (not a cookie) to recognize repeat visits.
          </li>
          <li>
            It runs only on the live site. Nothing is collected when the app runs locally or in
            development.
          </li>
          <li>
            It does not capture what you type - your email, password, and in-game answers are never
            sent to analytics. We identify a signed-in player only by a stable, non-sensitive id
            (your gamer tag) so we can understand repeat visits; anonymous players stay anonymous.
          </li>
          <li>Session replay is off. We do not record playback of your screen.</li>
        </ul>
        <p className="mt-3 text-body text-text-muted">
          PostHog processes this data on our behalf on servers in the United States. You can read
          how PostHog handles data in their{' '}
          <ExternalLink href="https://posthog.com/privacy">privacy policy</ExternalLink>.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">Accounts and what we store</h2>
        <p className="mt-3 text-body text-text-muted">
          If you create an account, we store what the account needs to work:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-body text-text-muted">
          <li>Your email address, used to sign you in and to contact you about your account.</li>
          <li>
            Your password, stored only as a secure one-way hash - we never store or see the password
            itself.
          </li>
          <li>
            Your public profile: a gamer tag, a nickname (defaults to your gamer tag), and an avatar
            you pick from a set. Your gamer tag and stars are always public; the rest follows your
            profile visibility setting.
          </li>
          <li>
            Your stars and a record of your recent games (which game, how you placed, when), so your
            profile can show your history.
          </li>
        </ul>
        <p className="mt-3 text-body text-text-muted">
          You control your nickname, avatar, and profile visibility from your account page.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">Playing without an account</h2>
        <p className="mt-3 text-body text-text-muted">
          You can join a game by code without signing up. When you do, we create a temporary,
          anonymous session tied to that game so your device can take part - it holds only the
          nickname you choose for the game and does not create an account or store an email.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">Cookies</h2>
        <p className="mt-3 text-body text-text-muted">
          When you sign in (or join a game by code), we set a single strictly-necessary first-party
          cookie so we can keep you signed in. It is <strong className="text-text">httpOnly</strong>{' '}
          and secure, and it just points to a session we keep on our own server - it holds no
          personal data itself and is not used to track you across other sites. We do not use
          advertising or cross-site tracking cookies.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">IP addresses and server logs</h2>
        <p className="mt-3 text-body text-text-muted">
          Like any website, our servers briefly see your IP address when you connect. We use it to
          keep the service running and secure, and our edge proxy may use it to protect the site
          (for example, against abuse). PostHog may use your IP address to estimate a general
          location (such as country or region) and does not store a precise location. We do not use
          IP addresses to identify you personally.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">Who processes data for us</h2>
        <p className="mt-3 text-body text-text-muted">
          We use a small number of service providers who process data on our behalf. Today that is
          PostHog (analytics and error reporting), on servers in the United States. We do not sell
          your data or share it with advertisers.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">Children</h2>
        <p className="mt-3 text-body text-text-muted">
          Branch Out Games is not directed at children under 13, and we do not knowingly collect
          information from them. If you believe a child has given us information, email us and we
          will delete it.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">Your choices and rights</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-body text-text-muted">
          <li>
            Because our analytics is first-party, a content blocker that targets third-party
            trackers will not stop it - but you can opt out with your browser&apos;s privacy
            settings (disable JavaScript, or clear this site&apos;s local storage), and the site
            will still work. We do not do any cross-site tracking.
          </li>
          <li>
            You can change your nickname, avatar, and profile visibility, or log out, any time.
          </li>
          <li>
            Depending on where you live, you may have the right to ask what data relates to you, to
            get a copy, or to ask us to delete it - including your account. To make a request, email{' '}
            <ContactEmail />.
          </li>
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">Changes to this policy</h2>
        <p className="mt-3 text-body text-text-muted">
          If we change how we handle data, we will update this page and the date at the top.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">Contact</h2>
        <p className="mt-3 text-body text-text-muted">
          Questions about privacy? Email <ContactEmail />.
        </p>
      </section>
    </article>
  );
}
