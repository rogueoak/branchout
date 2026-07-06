import type { LedgerRepository } from './repository';
import { DAILY_GRANT, isUnlimited, type TierProvider, UNLIMITED } from './tiers';

/** One credit per round is the default cost - the round-report intake is the only debiter. */
export const ROUND_COST = 1;

/** The outcome of an affordability check, with a user-safe reason when a start is refused. */
export interface Affordability {
  ok: boolean;
  /** Current balance (`UNLIMITED` for Party); useful for a clear refusal message. */
  balance: number;
  reason?: string;
}

/** Format an epoch millis as a UTC `YYYY-MM-DD` day key, so a grant is once per calendar day. */
function dayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * The credit ledger service: the single authority on grants, debits, balance, and affordability.
 *
 * - **Daily grant** is idempotent per account per day - the day key in the idempotency key means
 *   granting twice in a day is a no-op (Party grants nothing; it is unlimited).
 * - **Round debit** is idempotent per round id - the round-report intake is the *only* caller, so
 *   a round is billed exactly once even if the engine retries the report.
 * - **Balance** is the sum of the ledger; Party reads as `UNLIMITED`.
 * - **Affordability** refuses to start more rounds than the balance covers; Party short-circuits.
 */
export class CreditLedger {
  constructor(
    private readonly repo: LedgerRepository,
    private readonly tiers: TierProvider,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Grant today's credits for the account's tier, once. Idempotent: a second call the same day
   * writes nothing. A no-op for Party (unlimited has nothing to top up). Returns whether this call
   * actually granted (false = already granted today, or unlimited).
   */
  async grantDaily(accountId: string): Promise<boolean> {
    const tier = await this.tiers.getTier(accountId);
    if (isUnlimited(tier)) {
      return false;
    }
    return this.repo.append({
      accountId,
      delta: DAILY_GRANT[tier],
      reason: 'daily_grant',
      idempotencyKey: `grant:${accountId}:${dayKey(this.now())}`,
    });
  }

  /**
   * Debit one credit for a finished round. Idempotent per `roundId`: a retried report debits once.
   * Returns whether this call applied the debit (false = already debited this round).
   */
  async debitRound(accountId: string, roundId: string): Promise<boolean> {
    return this.repo.append({
      accountId,
      delta: -ROUND_COST,
      reason: 'round_debit',
      idempotencyKey: `debit:round:${roundId}`,
    });
  }

  /** Current balance for the account. `UNLIMITED` for Party; the ledger sum otherwise. */
  async balance(accountId: string): Promise<number> {
    const tier = await this.tiers.getTier(accountId);
    if (isUnlimited(tier)) {
      return UNLIMITED;
    }
    return this.repo.balance(accountId);
  }

  /**
   * Can the account afford `rounds` rounds? Party is always yes (unlimited short-circuit). Grants
   * today's credits first so a start does not fail for want of a grant that was due, then compares
   * the requested cost against the balance.
   */
  async canAfford(accountId: string, rounds: number): Promise<Affordability> {
    const tier = await this.tiers.getTier(accountId);
    if (isUnlimited(tier)) {
      return { ok: true, balance: UNLIMITED };
    }
    await this.grantDaily(accountId);
    const balance = await this.repo.balance(accountId);
    const cost = rounds * ROUND_COST;
    if (balance < cost) {
      return {
        ok: false,
        balance,
        reason: `Not enough credits: ${rounds} round(s) cost ${cost}, balance is ${balance}.`,
      };
    }
    return { ok: true, balance };
  }
}
