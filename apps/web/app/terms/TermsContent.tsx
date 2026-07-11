// The terms of service body (spec 0031). A plain, static component (no client hooks, no session) so
// it renders in a Server Component and is unit-testable on its own. Modelled on the common SaaS ToS
// sections (acceptance, eligibility, accounts, acceptable use, user content, IP, warranty disclaimer,
// liability limit, changes, termination, governing law, contact), kept short and plain. This is a
// good-faith draft; a legal review is still recommended. ASCII-only, Trellis voice.

import {
  GOVERNING_LAW,
  LEGAL_CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  OPERATING_ENTITY,
} from '../../lib/legal';

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

export function TermsContent() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-h1 font-bold text-text">Terms of Service</h1>
      <p className="mt-2 text-caption text-text-muted">Last updated: {LEGAL_LAST_UPDATED}</p>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">1. Acceptance</h2>
        <p className="mt-3 text-body text-text-muted">
          Branch Out Games is operated by {OPERATING_ENTITY} (&ldquo;we,&rdquo; &ldquo;us,&rdquo;
          &ldquo;our&rdquo;). By using Branch Out Games, you agree to these terms. If you do not
          agree, please do not use the service.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">2. Who can use it</h2>
        <p className="mt-3 text-body text-text-muted">
          The service is not directed at children under 13, and you may not use it if you are under
          13. If you are under the age of majority where you live, use it only with a parent&apos;s
          or guardian&apos;s permission.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">3. Your account</h2>
        <p className="mt-3 text-body text-text-muted">
          You can play without an account, or create one to save your progress and host games. If
          you create an account, keep your password secure and let us know if you think someone else
          is using it. You are responsible for what happens under your account.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">4. Acceptable use</h2>
        <p className="mt-3 text-body text-text-muted">Please play fair. Do not:</p>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-body text-text-muted">
          <li>cheat, exploit bugs, or interfere with other players&apos; games;</li>
          <li>harass, threaten, or abuse other players, or post hateful or illegal content;</li>
          <li>
            break, overload, scrape, or attempt to gain unauthorized access to the service or its
            systems;
          </li>
          <li>use the service to break the law or infringe anyone&apos;s rights.</li>
        </ul>
        <p className="mt-3 text-body text-text-muted">
          We may remove content or suspend access that breaks these rules.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">5. Your content</h2>
        <p className="mt-3 text-body text-text-muted">
          You are responsible for what you submit - your nickname, your answers, and anything else
          you type. Keep it clean and lawful. You give us permission to use what you submit as
          needed to run the game (for example, showing your answer to other players in your room).
          You keep any rights you already have in your content.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">6. Our content</h2>
        <p className="mt-3 text-body text-text-muted">
          Branch Out Games, including its name, logos, games, questions, and design, belongs to{' '}
          {OPERATING_ENTITY} or its licensors. We give you a personal, non-transferable permission
          to use the service to play. Do not copy, resell, or reuse our content except as the
          service allows.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">
          7. The service is provided &ldquo;as is&rdquo;
        </h2>
        <p className="mt-3 text-body text-text-muted">
          We work to keep Branch Out Games running well, but we provide it{' '}
          <strong className="text-text">
            &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties of any kind
          </strong>
          , whether express or implied, including any implied warranties of merchantability, fitness
          for a particular purpose, or non-infringement. We do not promise the service will be
          uninterrupted, error-free, or secure, or that it will always be available.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">8. Limitation of liability</h2>
        <p className="mt-3 text-body text-text-muted">
          To the fullest extent allowed by law, Branch Out Games and {OPERATING_ENTITY} are not
          liable for any indirect, incidental, special, or consequential damages, or for any loss of
          data, profits, or goodwill, arising from your use of (or inability to use) the service.
          Some places do not allow these limits, so parts of this section may not apply to you.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">9. Changes to these terms</h2>
        <p className="mt-3 text-body text-text-muted">
          We may change these terms at any time. When we do, we will update the &ldquo;Last
          updated&rdquo; date at the top of this page. If you keep using the service after a change,
          that means you accept the updated terms. If you do not agree, please stop using the
          service.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">10. Suspension and termination</h2>
        <p className="mt-3 text-body text-text-muted">
          You can stop using the service at any time. We may suspend or end your access if you break
          these terms or to protect the service and its players. You can ask us to delete your
          account by emailing us.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">11. Governing law</h2>
        <p className="mt-3 text-body text-text-muted">
          These terms are governed by the laws of {GOVERNING_LAW}, without regard to conflict-of-law
          rules.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-h2 font-semibold text-text">12. Contact</h2>
        <p className="mt-3 text-body text-text-muted">
          Questions about these terms? Email <ContactEmail />.
        </p>
      </section>
    </article>
  );
}
