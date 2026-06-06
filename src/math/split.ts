/**
 * How one expense divides among its participants — the per-expense split,
 * computed in the expense's OWN currency (minor units), so the penny-remainder
 * rule is exact and matches what the payer sees.
 *
 * Penny remainder (a split that doesn't divide evenly) is absorbed by the
 * PAYER — the person who paid eats the leftover cent(s); with multiple payers,
 * the largest payer, tie-broken by member id (spec, Josh 2026-06-05). This is
 * a pure, deterministic function: same expense in → identical shares out.
 */

import type { Expense, Payer, SplitPart } from '../data/types';

/** The payer who absorbs the rounding remainder: largest amount, then lowest
 *  member id. Null only if the expense has no payers (shouldn't happen). */
export function absorbingPayer(payers: Payer[]): string | null {
  if (payers.length === 0) return null;
  let best = payers[0];
  for (const p of payers) {
    if (p.amount > best.amount) best = p;
    else if (p.amount === best.amount && p.memberId < best.memberId) best = p;
  }
  return best.memberId;
}

/** Raw (pre-remainder) integer share for each participant, by method. */
function rawShares(
  amount: number,
  method: Expense['splitMethod'],
  splits: SplitPart[],
): Map<string, number> {
  const owed = new Map<string, number>();
  if (splits.length === 0) return owed;

  if (method === 'exact') {
    for (const s of splits) owed.set(s.memberId, Math.round(s.value));
    return owed;
  }

  // equal: everyone in `splits` weighs 1. shares/percent: weight = value.
  const weights = splits.map((s) =>
    method === 'equal' ? 1 : Math.max(0, s.value),
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) {
    // Degenerate (all-zero weights): fall back to an equal split so the
    // expense still balances rather than vanishing.
    const each = Math.floor(amount / splits.length);
    splits.forEach((s) => owed.set(s.memberId, each));
    return owed;
  }
  splits.forEach((s, i) => {
    owed.set(s.memberId, Math.floor((amount * weights[i]) / totalWeight));
  });
  return owed;
}

/**
 * Per-member amount owed for this expense, in the expense's currency (minor
 * units). Sum of the returned values === expense.amount exactly. The absorbing
 * payer's share carries the remainder (positive for floor-split methods; for
 * `exact` it can be ± if the entered amounts don't sum to the total).
 */
export function computeOwed(e: Expense): Map<string, number> {
  const owed = rawShares(e.amount, e.splitMethod, e.splits);
  const assigned = Array.from(owed.values()).reduce((a, b) => a + b, 0);
  const remainder = e.amount - assigned;
  if (remainder !== 0) {
    const absorber = absorbingPayer(e.payers) ?? e.splits[0]?.memberId;
    if (absorber != null) {
      owed.set(absorber, (owed.get(absorber) ?? 0) + remainder);
    }
  }
  return owed;
}

/** Per-member amount paid for this expense, in the expense's currency. */
export function computePaid(e: Expense): Map<string, number> {
  const paid = new Map<string, number>();
  for (const p of e.payers) {
    paid.set(p.memberId, (paid.get(p.memberId) ?? 0) + p.amount);
  }
  return paid;
}

/** Validation helpers the editor uses (in the expense's own currency). */
export function payersTotal(payers: Payer[]): number {
  return payers.reduce((a, p) => a + p.amount, 0);
}

export function exactSplitTotal(splits: SplitPart[]): number {
  return splits.reduce((a, s) => a + Math.round(s.value), 0);
}
