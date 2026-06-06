/**
 * Derived balances and the minimal-transfer settle-up plan — the numbers
 * everyone in a group must see identically.
 *
 * These are PURE functions over the converged ledger. Nothing here is ever
 * stored or synced: the same Group state in always yields byte-identical
 * output, on every device. That makes balance divergence (the category's worst
 * reliability bug) structurally impossible.
 *
 * Everything is computed in the group's BASE currency, in integer minor units.
 * Each expense's per-member net (paid − owed, in its own currency) is converted
 * to base via the expense's at-entry-time rate, using a sum-preserving
 * conversion so the converted balance set still sums to zero.
 */

import type { Group } from '../data/types';
import { convertOne, convertPreservingSum } from '../data/money';
import { computeOwed, computePaid } from './split';

export interface Transfer {
  from: string;
  to: string;
  /** Base currency, minor units. Always positive. */
  amount: number;
}

const active = <T extends { deletedAt?: number }>(rows: T[]): T[] =>
  rows.filter((r) => r.deletedAt == null);

/**
 * Net position per member in the group's base currency (minor units).
 * Positive = owed money (paid more than their share); negative = owes.
 * The returned map sums to zero (modulo nothing — conversions preserve it).
 * Members with a zero net are present so callers can show "all settled".
 */
export function computeBalances(group: Group): Map<string, number> {
  const base = group.baseCurrency;
  const net = new Map<string, number>();
  for (const m of active(group.members)) net.set(m.id, 0);
  const bump = (id: string, delta: number) =>
    net.set(id, (net.get(id) ?? 0) + delta);

  for (const e of active(group.expenses)) {
    const paid = computePaid(e);
    const owed = computeOwed(e);
    // Union of everyone involved, in a stable order (sorted id) so the
    // sum-preserving conversion is deterministic across devices.
    const ids = Array.from(new Set([...paid.keys(), ...owed.keys()])).sort();
    const netsExpense = ids.map((id) => (paid.get(id) ?? 0) - (owed.get(id) ?? 0));
    const netsBase = convertPreservingSum(netsExpense, e.rate, e.currency, base);
    ids.forEach((id, i) => bump(id, netsBase[i]));
  }

  for (const s of active(group.settlements)) {
    // A payment from→to: `from` has now contributed, `to` has been paid.
    const amtBase = convertOne(s.amount, s.rate, s.currency, base);
    bump(s.fromMember, amtBase);
    bump(s.toMember, -amtBase);
  }

  return net;
}

/**
 * The fewest payments that settle every debt (greedy minimal transfers):
 * repeatedly match the largest creditor with the largest debtor, settle the
 * smaller magnitude, repeat. Deterministic tie-breaks by member id.
 *
 * Input is a balance map (base minor units summing to zero); output is a list
 * of positive transfers in base currency.
 */
export function computeSettlement(balances: Map<string, number>): Transfer[] {
  const creditors = [...balances.entries()]
    .filter(([, v]) => v > 0)
    .map(([id, amount]) => ({ id, amount }));
  const debtors = [...balances.entries()]
    .filter(([, v]) => v < 0)
    .map(([id, amount]) => ({ id, amount: -amount }));

  // Largest first, ties by lowest id — fully order-independent of the Map.
  const order = (a: { id: string; amount: number }, b: { id: string; amount: number }) =>
    b.amount - a.amount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  creditors.sort(order);
  debtors.sort(order);

  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci];
    const d = debtors[di];
    const pay = Math.min(c.amount, d.amount);
    if (pay > 0) transfers.push({ from: d.id, to: c.id, amount: pay });
    c.amount -= pay;
    d.amount -= pay;
    if (c.amount === 0) ci++;
    if (d.amount === 0) di++;
  }
  return transfers;
}

export interface MemberSummary {
  /** Total this member paid across all active expenses, in base minor units. */
  paid: number;
  /** Total this member's share came to, in base minor units. */
  share: number;
  /** Net settlements (paid out − received), base minor units. */
  settled: number;
  /** Net position = paid − share + settled. Matches computeBalances. */
  net: number;
}

/**
 * The "show its work" breakdown behind one member's balance — what they paid,
 * what their share was, and the settlement effect, all in base currency. Lets
 * any balance be tapped to see why it is what it is.
 */
export function computeMemberSummary(group: Group, memberId: string): MemberSummary {
  const base = group.baseCurrency;
  let paid = 0;
  let share = 0;
  for (const e of active(group.expenses)) {
    const p = computePaid(e).get(memberId) ?? 0;
    const o = computeOwed(e).get(memberId) ?? 0;
    if (p) paid += convertOne(p, e.rate, e.currency, base);
    if (o) share += convertOne(o, e.rate, e.currency, base);
  }
  let settled = 0;
  for (const s of active(group.settlements)) {
    const amtBase = convertOne(s.amount, s.rate, s.currency, base);
    if (s.fromMember === memberId) settled += amtBase;
    if (s.toMember === memberId) settled -= amtBase;
  }
  return { paid, share, settled, net: paid - share + settled };
}
