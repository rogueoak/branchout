import { Badge, buttonVariants } from '@rogueoak/canopy';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Footer } from '../../../components/Footer';
import { TopNav } from '../../../components/TopNav';
import {
  gameFeatureMetadata,
  gameJsonLd,
  getFeatureEntry,
  getGameCard,
  insiderFeatureMetadata,
  startGameHref,
} from '../../../lib/games/catalog';
import { getViewer } from '../../../lib/session';
import { getSurface } from '../../../lib/surface';
import { Chip } from '../../../components/game/Chip';
import { RulesContent } from '../../../components/game/RulesContent';
import { getGameRules } from '../../../lib/games/library';

// A per-game feature page (spec 0030): a hero-first landing page that sells one game - the hero art,
// the game mark + title, the badge + tags row (the same resolved data the card uses, spec 0065), the
// full Rules overview (spec 0051), and a closing "Ready to play" CTA that deep-links into the room
// flow (`?game=<slug>`, spec 0029). The nav renders the viewer server-side (spec 0028).
//
// One page, two surfaces (spec 0030): the page is surface-aware. A public game resolves on both the
// apex and the insider surface; an insider game (spec 0043) resolves ONLY on the insider surface
// (behind the insider layout gate) and 404s on the apex - it must never exist on the public site.
// The insider host serves this via the mirrored `/insider/games/[slug]` route. SEO (metadata,
// canonical, OG/Twitter, JSON-LD) emits only for public games; an insider page is `noindex` with no
// structured data.

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Render per-request (SSR), not a static prerender. The shared nav reads the viewer (spec 0028) and
// the surface is read from the request host, so the signed-in state and the apex-vs-insider
// resolution must resolve per request - a static prerender would bake in one surface and the
// signed-out nav. SEO is unaffected: the server returns full HTML + per-game metadata/JSON-LD to a
// crawler, and the sitemap (app/sitemap.ts) enumerates every PUBLIC feature route from the catalog.

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const surface = await getSurface();
  const entry = getFeatureEntry(slug, surface);
  if (!entry) return { title: 'Game not found - Branch Out Games' };
  // SEO only where it is public: an insider game (only reachable on the gated insider surface) is
  // noindex with no canonical/JSON-LD; a public game keeps the full share-card + canonical block.
  return entry.visibility === 'insider'
    ? insiderFeatureMetadata(entry)
    : (gameFeatureMetadata(entry.slug) ?? { title: 'Game not found - Branch Out Games' });
}

export default async function GameFeaturePage({ params }: PageProps) {
  const { slug } = await params;
  const surface = await getSurface();
  // Surface-aware resolution (spec 0030): public games resolve on both surfaces; an insider game
  // resolves only on the insider surface, else notFound() - so an insider slug 404s on the apex.
  const entry = getFeatureEntry(slug, surface);
  if (!entry) notFound();
  const viewer = await getViewer();
  // The one resolved card shape (spec 0065): hero art, mark, badge, library tags, and the insider
  // flag - the SAME data the /games and insider cards render, so the page and the card never drift.
  const card = getGameCard(entry.slug);
  // Auth-aware CTA: signed-in -> straight into the room deep link; anonymous -> signup first,
  // preserving the game (a first-timer must not hit the "hosting needs an account" wall).
  const startHref = startGameHref(entry.slug, viewer.signedIn);
  // The full rules overview (spec 0051). Every game has a library entry (the completeness check
  // holds), so it resolves; guarded anyway so a missing entry degrades softly.
  const rules = getGameRules(entry.slug);
  const isInsider = entry.visibility === 'insider';
  // The hero art in a 16:9 box, falling back to the mark when a game ships no hero (getGameCard
  // always resolves one). The catalog badge in the row is suppressed for an insider game - the
  // "Insiders" badge beside the title already conveys it - exactly as the card does (spec 0065).
  const hero = card?.hero ?? entry.icon;
  const tags = card?.tags ?? [];

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      {/* JSON-LD structured data (schema.org VideoGame) for rich results - PUBLIC games only. The
          value is built from the catalog (not user input), so dangerouslySetInnerHTML is safe. An
          insider page emits no structured data (it is gated + noindex). */}
      {isInsider ? null : (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(gameJsonLd(entry)) }}
        />
      )}
      <TopNav
        viewer={viewer}
        label={surface.insider ? 'Insider' : undefined}
        linkOrigin={surface.linkOrigin || undefined}
        insider={surface.insider}
      />

      <main className="flex-1">
        {/* Hero + title + badge/tags row (spec 0030). Capped to a readable measure and centered; the
            hero box owns its own sizing so it never overflows a 360px phone. */}
        <section
          aria-labelledby="game-heading"
          className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-14"
        >
          {/* The wide 16:9 hero: a build-time SVG string from the brand package (not user input),
              inlined like the game mark. block + h-full + w-full on the SVG stops any intrinsic width
              leaking past the box and overflowing the phone. aria-hidden - the heading names the game. */}
          <div
            aria-hidden="true"
            className="aspect-[16/9] w-full overflow-hidden rounded-2xl bg-[#0d0a15] [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: hero }}
          />

          {/* The mark + title inline beneath the hero, with the "Insiders" badge pinned right (matches
              the card). min-w-0 + break-words so a long name cannot overflow the phone. */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-block h-14 w-14 shrink-0 overflow-hidden rounded-xl [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: entry.icon }}
              />
              <h1 id="game-heading" className="text-h1 text-text min-w-0 break-words">
                {entry.name}
              </h1>
            </div>
            {isInsider ? (
              <Badge variant="primary" className="shrink-0">
                Insiders
              </Badge>
            ) : null}
          </div>

          {/* The badge + tags row directly under the title (spec 0065). The catalog badge is
              suppressed for an insider game (its "Insiders" badge already conveys it), matching the
              card so page and card agree. The tags are library-taxonomy Chips. */}
          {!isInsider || tags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {isInsider ? null : <Badge variant={entry.badge.variant}>{entry.badge.label}</Badge>}
              {tags.length > 0 ? (
                <ul className="flex flex-wrap gap-2" role="list">
                  {tags.map((tag) => (
                    <Chip key={tag.slug} variant="tag">
                      {tag.label}
                    </Chip>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <p className="text-body text-text-muted">{entry.description}</p>

          <div className="flex flex-wrap items-center gap-3">
            <a href={startHref} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              Start a game
            </a>
          </div>
        </section>

        {/* Rules (spec 0051): the full rules overview - the objective and each headed section - so a
            visitor can read the whole game before starting, the same content the in-game help sheet
            shows. */}
        {rules ? (
          <section aria-labelledby="rules-heading" className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
            <h2 id="rules-heading" className="text-h2 mb-6 text-center text-text">
              Rules
            </h2>
            <RulesContent name={entry.name} rules={rules} />
          </section>
        ) : null}

        {/* Closing CTA */}
        <section className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-14 text-center sm:px-6">
          <h2 className="text-h2 text-text">Ready to play {entry.name}?</h2>
          <a href={startHref} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            Start a game
          </a>
        </section>
      </main>

      <Footer linkOrigin={surface.linkOrigin || undefined} />
    </div>
  );
}
