import type { Metadata } from 'next';
import { Avatar } from '../../../components/Avatar';
import { fetchProfile, type PublicProfile } from '../../../lib/profile-api';
import { ProfileShare } from './ProfileShare';

// Public player profile (spec 0027). A Server Component: the visibility gate is applied server-side
// by the control-plane, so this just renders whatever the projection returns (full when public;
// gamer tag + stars only when private/friends-only). No session - the endpoint is public, so a
// crawler and a signed-out visitor both work.

interface PageProps {
  params: Promise<{ gamerTag: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { gamerTag } = await params;
  const profile = await fetchProfile(gamerTag);
  if (!profile) {
    return { title: 'Player not found - Branch Out' };
  }
  const name = profile.nickname ?? profile.gamerTag;
  return {
    title: `${name} (@${profile.gamerTag}) - Branch Out`,
    description: `${name} has earned ${profile.totalStars} stars on Branch Out. See their recent games.`,
  };
}

/** Prettify a game id (`liar-liar` -> `Liar Liar`) for display without pulling in the game registry. */
function gameName(id: string): string {
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function StarBadge({ stars }: { stars: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-raised px-3 py-1 text-body-sm font-medium text-text">
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-primary">
        <path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7L12 2z" />
      </svg>
      {stars} {stars === 1 ? 'star' : 'stars'}
    </span>
  );
}

export default async function ProfilePage({ params }: PageProps) {
  const { gamerTag } = await params;
  const profile = await fetchProfile(gamerTag);

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6 sm:py-16">
        <a
          href="/"
          className="text-body-sm text-text-muted underline-offset-4 hover:text-text hover:underline"
        >
          Branch Out
        </a>
        {profile ? <ProfileBody profile={profile} /> : <NotFound gamerTag={gamerTag} />}
      </div>
    </main>
  );
}

function NotFound({ gamerTag }: { gamerTag: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-h2 text-text">Player not found</h1>
      <p className="text-body text-text-muted">
        No player goes by <span className="font-medium text-text">@{gamerTag}</span> on Branch Out.
      </p>
    </section>
  );
}

function ProfileBody({ profile }: { profile: PublicProfile }) {
  const name = profile.nickname ?? profile.gamerTag;
  return (
    <>
      <header className="flex max-w-full items-center gap-4">
        <Avatar avatar={profile.avatar} name={name} className="h-20 w-20" />
        {/* min-w-0 + break-words so a long, space-less name (a nickname defaults to the gamer tag)
            wraps instead of overflowing the phone viewport (the profile e2e caught this). */}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-h2 text-text break-words">{name}</h1>
          <p className="text-body-sm text-text-muted break-words">@{profile.gamerTag}</p>
        </div>
      </header>

      <section aria-label="Stars" className="flex flex-wrap items-center gap-3">
        <StarBadge stars={profile.totalStars} />
        <ProfileShare name={name} />
      </section>

      {profile.restricted ? (
        <p className="text-body-sm text-text-muted" role="status">
          {profile.visibility === 'friends-only'
            ? 'This profile is friends-only. Only the gamer tag and stars are public for now.'
            : 'This profile is private. Only the gamer tag and stars are public.'}
        </p>
      ) : (
        <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
          <h2 id="recent-heading" className="text-h4 text-text">
            Recent games
          </h2>
          {profile.recentPlays && profile.recentPlays.length > 0 ? (
            <ul className="flex flex-col gap-2" role="list">
              {profile.recentPlays.map((play, i) => (
                <li
                  key={`${play.game}-${play.playedAt}-${i}`}
                  className="flex items-center justify-between rounded-md bg-surface-raised px-3 py-2"
                >
                  <span className="flex flex-col">
                    <span className="text-body text-text">{gameName(play.game)}</span>
                    <span className="text-body-sm text-text-muted">Placed #{play.rank}</span>
                  </span>
                  <span className="text-body-sm font-medium text-text">
                    {play.stars} {play.stars === 1 ? 'star' : 'stars'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-sm text-text-muted">No games played yet.</p>
          )}
        </section>
      )}
    </>
  );
}
