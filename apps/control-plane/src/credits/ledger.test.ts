import { describe, expect, it } from 'vitest';
import { CreditLedger } from './ledger';
import { InMemoryLedgerRepository } from './repository.memory';
import { StaticTierProvider, UnlimitedTierProvider } from './tiers';

/** A ledger with a fixed clock and a pinned tier per account, for deterministic tests. */
function makeLedger(
  tier: Record<string, 'free' | 'gathering' | 'party'>,
  nowMs = Date.UTC(2026, 6, 5),
) {
  const repo = new InMemoryLedgerRepository();
  const ledger = new CreditLedger(repo, new StaticTierProvider(tier), () => nowMs);
  return { ledger, repo };
}

describe('daily grant', () => {
  it('grants the tier amount once per day (idempotent)', async () => {
    const { ledger, repo } = makeLedger({ acct: 'free' });
    expect(await ledger.grantDaily('acct')).toBe(true);
    // Second grant the same day is a no-op: no new entry, balance unchanged.
    expect(await ledger.grantDaily('acct')).toBe(false);
    expect(await ledger.balance('acct')).toBe(10);
    expect(repo.all().filter((e) => e.reason === 'daily_grant')).toHaveLength(1);
  });

  it('grants a new day after the day rolls over', async () => {
    const repo = new InMemoryLedgerRepository();
    let now = Date.UTC(2026, 6, 5, 10);
    const ledger = new CreditLedger(repo, new StaticTierProvider({ acct: 'free' }), () => now);
    expect(await ledger.grantDaily('acct')).toBe(true);
    now = Date.UTC(2026, 6, 6, 10); // next day
    expect(await ledger.grantDaily('acct')).toBe(true);
    expect(await ledger.balance('acct')).toBe(20);
  });

  it('grants the Gathering amount (50) and never grants for Party (unlimited)', async () => {
    const gathering = makeLedger({ acct: 'gathering' });
    await gathering.ledger.grantDaily('acct');
    expect(await gathering.ledger.balance('acct')).toBe(50);

    const party = makeLedger({ acct: 'party' });
    expect(await party.ledger.grantDaily('acct')).toBe(false);
    expect(await party.ledger.balance('acct')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('affordability', () => {
  it('affords rounds within the daily grant (grant applied lazily on the check)', async () => {
    const { ledger } = makeLedger({ acct: 'free' });
    const result = await ledger.canAfford('acct', 10);
    expect(result.ok).toBe(true);
    expect(result.balance).toBe(10);
  });

  it('refuses more rounds than the balance covers, with a clear reason', async () => {
    const { ledger } = makeLedger({ acct: 'free' });
    const result = await ledger.canAfford('acct', 11);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not enough credits/i);
  });

  it('treats Party as unlimited: any round count is affordable', async () => {
    const { ledger, repo } = makeLedger({ acct: 'party' });
    const result = await ledger.canAfford('acct', 1000);
    expect(result.ok).toBe(true);
    expect(result.balance).toBe(Number.POSITIVE_INFINITY);
    // Unlimited short-circuits: no grant row is written for Party.
    expect(repo.all()).toHaveLength(0);
  });

  it('UnlimitedTierProvider makes games free: a full Teeter round budget is affordable', async () => {
    // The "games are free for now" wiring - every account reads as unlimited, so Teeter's ~53-round
    // budget (the start that used to fail with "need 53 credits") is affordable on a zero balance.
    const ledger = new CreditLedger(new InMemoryLedgerRepository(), new UnlimitedTierProvider());
    const result = await ledger.canAfford('acct', 53);
    expect(result.ok).toBe(true);
    expect(result.balance).toBe(Number.POSITIVE_INFINITY);
  });

  it('afford reflects prior debits', async () => {
    const { ledger } = makeLedger({ acct: 'free' });
    await ledger.grantDaily('acct'); // 10
    await ledger.debitRound('acct', 'r1'); // 9
    await ledger.debitRound('acct', 'r2'); // 8
    const eight = await ledger.canAfford('acct', 8);
    expect(eight.ok).toBe(true);
    const nine = await ledger.canAfford('acct', 9);
    expect(nine.ok).toBe(false);
  });
});

describe('round debit', () => {
  it('debits exactly one credit per round id (idempotent on retry)', async () => {
    const { ledger, repo } = makeLedger({ acct: 'free' });
    await ledger.grantDaily('acct');
    expect(await ledger.debitRound('acct', 'round-1')).toBe(true);
    // A retried report with the same round id does not debit again.
    expect(await ledger.debitRound('acct', 'round-1')).toBe(false);
    expect(await ledger.balance('acct')).toBe(9);
    expect(repo.all().filter((e) => e.reason === 'round_debit')).toHaveLength(1);
  });
});
