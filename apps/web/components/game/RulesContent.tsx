// The single rules renderer (spec 0051): the objective as a lead line, then each rules section as a
// heading + paragraphs, with an optional quick-start strip (the catalog's three how-to-play steps).
// Pure presentational - no dialog, positioning, or data-fetch concerns - so its three homes share one
// look: the feature page renders it inline, the help sheet renders it in the sheet body, and the
// insider card renders it in its sheet. Reads well at 360px (single column, muted body copy).

import type { HowToStep } from '../../lib/games/catalog';
import type { GameRules } from '../../lib/games/library';

interface RulesContentProps {
  /** The game name, for the objective's lead-in and the quick-start heading. */
  name: string;
  rules: GameRules;
  /** Optional: the catalog's three how-to-play steps, shown as a quick-start strip. */
  howToPlay?: HowToStep[];
}

export function RulesContent({ name, rules, howToPlay }: RulesContentProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* Objective as the lead line - the one sentence that says how you win, set apart from the
          sections so a player reading mid-game gets the point first. */}
      <p className="text-body text-text">
        <span className="font-semibold text-text">Goal: </span>
        {rules.objective}
      </p>

      {rules.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-2">
          <h3 className="text-h4 text-text">{section.heading}</h3>
          {section.body.map((paragraph, i) => (
            <p key={i} className="text-body-sm text-text-muted">
              {paragraph}
            </p>
          ))}
        </section>
      ))}

      {howToPlay && howToPlay.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-4">
          <h3 className="text-h4 text-text">Quick start</h3>
          <ol className="flex flex-col gap-3" role="list">
            {howToPlay.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span aria-hidden="true" className="text-body font-bold text-primary">
                  {i + 1}
                </span>
                <div className="flex flex-col gap-1">
                  <span className="text-body-sm font-medium text-text">{step.title}</span>
                  <span className="text-body-sm text-text-muted">{step.body}</span>
                </div>
              </li>
            ))}
          </ol>
          <p className="sr-only">Quick start for {name}.</p>
        </section>
      ) : null}
    </div>
  );
}
