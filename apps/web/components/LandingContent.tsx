'use client';

import { Badge, buttonVariants } from '@rogueoak/canopy';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@rogueoak/canopy/twigs';
import { Logo } from './Logo';

interface LandingContentProps {
  signedIn: boolean;
}

// How it works: three steps from join code to playing.
const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Make a room',
    body: 'Pick a game and start a room as the host. You get a short join code.',
  },
  {
    step: '2',
    title: 'Share the code',
    body: 'Anyone with the code can join - no account needed.',
  },
  {
    step: '3',
    title: 'Play together',
    body: 'Play, earn stars, and run another game when you are done.',
  },
];

// Pricing tiers: Free / Gathering / Party (spec 0005, amounts from spec 0006).
const TIERS = [
  {
    id: 'free',
    name: 'Free',
    price: 'Free',
    credits: '10 credits per day',
    cta: 'Get started',
    href: '/signup',
    highlight: false,
  },
  {
    id: 'gathering',
    name: 'Gathering',
    price: '7 USD / 10 CAD',
    credits: '50 credits per day',
    cta: 'Get started',
    href: '/signup',
    highlight: true,
  },
  {
    id: 'party',
    name: 'Party',
    price: '10 USD / 14 CAD',
    credits: 'Unlimited credits',
    cta: 'Get started',
    href: '/signup',
    highlight: false,
  },
] as const;

export function LandingContent({ signedIn }: LandingContentProps) {
  const primaryCta = signedIn
    ? { label: 'Play now', href: '/rooms' }
    : { label: 'Sign up free', href: '/signup' };

  return (
    <div className="bg-bg text-text">
      {/* Site header: wordmark on the left, Log in on the right. */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo className="h-10" />
        <nav aria-label="Site navigation">
          <a
            href="/login"
            className="text-body-sm font-medium text-text-muted underline-offset-4 hover:text-text hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Log in
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section
        aria-labelledby="hero-heading"
        className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24"
      >
        <h1 id="hero-heading" className="text-display text-text">
          where game night grows
        </h1>
        <p className="text-body text-text-muted max-w-xl">
          Start a room, share the code, and play games with whoever joins. No setup. No fuss.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a href={primaryCta.href} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            {primaryCta.label}
          </a>
          <a href="#games" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            Browse games
          </a>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-heading" className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <h2 id="how-heading" className="text-h2 mb-10 text-center text-text">
          How it works
        </h2>
        <ol className="grid grid-cols-1 gap-6 sm:grid-cols-3" role="list">
          {HOW_IT_WORKS.map(({ step, title, body }) => (
            <li key={step} className="flex flex-col gap-3">
              <Badge variant="primary" className="w-fit">
                {step}
              </Badge>
              <h3 className="text-h4 text-text">{title}</h3>
              <p className="text-body-sm text-text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Tiers */}
      <section aria-labelledby="tiers-heading" className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <h2 id="tiers-heading" className="text-h2 mb-10 text-center text-text">
          Pick a plan
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {TIERS.map((tier) => (
            <Card
              key={tier.id}
              className={tier.highlight ? 'border-primary ring-1 ring-primary' : undefined}
            >
              <CardHeader>
                <CardTitle asChild>
                  <h3>{tier.name}</h3>
                </CardTitle>
                {tier.highlight ? (
                  <Badge variant="primary" className="mt-1 w-fit">
                    Popular
                  </Badge>
                ) : null}
                <CardDescription>{tier.credits}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-h3 text-text">{tier.price}</p>
                <p className="text-caption text-text-muted">per month</p>
              </CardContent>
              <CardFooter>
                <a
                  href={tier.href}
                  className={buttonVariants({
                    variant: tier.highlight ? 'primary' : 'outline',
                    size: 'sm',
                  })}
                >
                  {tier.cta}
                </a>
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>

      {/* Games teaser */}
      <section
        id="games"
        aria-labelledby="games-heading"
        className="mx-auto max-w-5xl px-4 py-16 sm:px-6"
      >
        <h2 id="games-heading" className="text-h2 mb-10 text-center text-text">
          What you can play
        </h2>
        <div className="flex flex-wrap gap-6">
          <Card className="w-full sm:w-72">
            <CardHeader>
              <CardTitle asChild>
                <h3>Trivia</h3>
              </CardTitle>
              <Badge variant="info" className="mt-1 w-fit">
                Featured
              </Badge>
              <CardDescription>
                800+ questions across 8 categories. Rounds are fast; scores settle the debate.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-body-sm text-text-muted">
                Nature, Food, Animals, Science, People, Places, Things, History
              </p>
            </CardContent>
          </Card>
        </div>
        <p className="mt-6 text-body-sm text-text-muted">More games on the way.</p>
      </section>

      {/* Footer */}
      <footer className="mx-auto max-w-5xl border-t border-border px-4 py-8 sm:px-6">
        <p className="text-body-sm text-text-muted">Branch out - where game night grows.</p>
      </footer>
    </div>
  );
}
