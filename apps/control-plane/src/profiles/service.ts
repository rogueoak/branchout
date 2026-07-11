import type { AccountService } from '../accounts/service';
import type { ProfileVisibility } from '../accounts/repository';
import type { PlaysRepository } from './plays';

/** One entry in the recent-plays timeline (never carries account/session data). */
export interface ProfilePlay {
  game: string;
  rank: number;
  stars: number;
  /** ISO timestamp - the wire is JSON, so no Date objects. */
  playedAt: string;
}

/**
 * The public projection of a profile (spec 0027). Deliberately MINIMAL: gamer tag and total stars
 * are always public; the rest appears only when visibility is `public`. It NEVER carries email,
 * account id, or session - a test asserts those never appear, so a later change cannot widen this
 * into a leak (the 0025 minimal-projection learning).
 */
export interface PublicProfile {
  gamerTag: string;
  totalStars: number;
  visibility: ProfileVisibility;
  /** True when the detail below is withheld by visibility (the page shows a "private" note). */
  restricted: boolean;
  nickname?: string;
  avatar?: string;
  recentPlays?: ProfilePlay[];
}

const RECENT_LIMIT = 10;

/**
 * Reads a public profile by gamer tag and applies the visibility gate - the ONE place the rule
 * lives (a projection, not a second store). `public` returns the full profile; `private` and (until
 * friends ship) `friends-only` return only the always-public gamer tag + stars.
 */
export class ProfileService {
  constructor(
    private readonly accounts: AccountService,
    private readonly plays: PlaysRepository,
  ) {}

  /** The public profile for a gamer tag, or `null` when no such account exists (route 404s). */
  async getPublicProfile(gamerTag: string): Promise<PublicProfile | null> {
    const account = await this.accounts.getByGamerTag(gamerTag);
    if (!account) {
      return null;
    }
    const totalStars = await this.plays.totalStars(account.id);
    const base = {
      gamerTag: account.gamerTag,
      totalStars,
      visibility: account.visibility,
    };

    // Non-public profiles reveal only the always-public fields. `friends-only` collapses to this
    // too until the friend graph exists (a later spec) - there is no viewer identity here to be a
    // friend of, and this endpoint is public (a crawler has no session).
    if (account.visibility !== 'public') {
      return { ...base, restricted: true };
    }

    const recent = await this.plays.recentPlays(account.id, RECENT_LIMIT);
    return {
      ...base,
      restricted: false,
      nickname: account.nickname,
      avatar: account.avatar,
      recentPlays: recent.map((play) => ({
        game: play.game,
        rank: play.rank,
        stars: play.stars,
        playedAt: play.playedAt.toISOString(),
      })),
    };
  }
}
