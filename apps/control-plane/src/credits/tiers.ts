/**
 * Subscription tiers and their daily credit grant. Owned here (the credit domain) because the
 * grant amount is a billing rule, not a room rule. Purchases and tier changes are a later spec
 * (Purchases); this spec only reads a tier to size the daily grant and the affordability check.
 *
 * Party is *unlimited*: it never runs out of credits, so the affordability check short-circuits
 * to `true` and the balance reads as `UNLIMITED` rather than a finite sum.
 */
export type Tier = 'free' | 'gathering' | 'party';

/** Sentinel for an unlimited (Party) balance - distinguishes "infinite" from any real number. */
export const UNLIMITED = Number.POSITIVE_INFINITY;

/**
 * Credits granted per account per day, by tier. `UNLIMITED` for Party means the daily grant is a
 * no-op (there is nothing to top up) and the balance is always unlimited.
 */
export const DAILY_GRANT: Record<Tier, number> = {
  free: 10,
  gathering: 50,
  party: UNLIMITED,
};

/** True for the unlimited (Party) tier - callers short-circuit grant/affordability for it. */
export function isUnlimited(tier: Tier): boolean {
  return DAILY_GRANT[tier] === UNLIMITED;
}

/**
 * The tier for an account. Subscriptions are a later spec (Purchases), so until they exist every
 * account is Free; this indirection is the seam a subscription store plugs into without touching
 * the ledger. Injected into the ledger so tests can pin a tier.
 */
export interface TierProvider {
  getTier(accountId: string): Promise<Tier>;
}

/** Default provider: every account is Free until the Purchases spec adds real subscriptions. */
export class FreeTierProvider implements TierProvider {
  async getTier(): Promise<Tier> {
    return 'free';
  }
}

/**
 * Temporary "games are free for now" provider: every account reads as the unlimited Party tier, so
 * the affordability check short-circuits to `true` and no start is ever refused for want of credits.
 * Wired in place of {@link FreeTierProvider} in production until the Purchases spec ships; swap it
 * back to charge credits again. Debits still append to the ledger (inert - a Party balance reads
 * `UNLIMITED`), so restoring paid play is a one-line provider swap with the ledger intact.
 */
export class UnlimitedTierProvider implements TierProvider {
  async getTier(): Promise<Tier> {
    return 'party';
  }
}

/** Test/seed provider: hand it an explicit map of account id -> tier, defaulting to Free. */
export class StaticTierProvider implements TierProvider {
  constructor(private readonly tiers: Record<string, Tier> = {}) {}

  async getTier(accountId: string): Promise<Tier> {
    return this.tiers[accountId] ?? 'free';
  }
}
