/**
 * The split math is the trust core — these tests pin the worked examples the
 * spec promises ("the split math is correct, and it shows its work").
 */

import type { Expense, Group, Member, Settlement } from '../../data/types';
import { computeOwed, computePaid, absorbingPayer } from '../split';
import {
  computeBalances,
  computeSettlement,
  computeMemberSummary,
} from '../balances';

let seq = 0;
const t = () => ++seq;

function member(id: string): Member {
  return { id, displayName: id, createdAt: t(), updatedAt: t() };
}

function expense(p: Partial<Expense> & Pick<Expense, 'amount'>): Expense {
  return {
    id: `e${t()}`,
    description: '',
    currency: 'USD',
    rate: 1,
    category: 'general',
    date: t(),
    payers: [],
    splitMethod: 'equal',
    splits: [],
    createdAt: t(),
    updatedAt: t(),
    ...p,
  };
}

function group(p: Partial<Group> & Pick<Group, 'members' | 'expenses'>): Group {
  return {
    id: 'g1',
    name: 'Test',
    baseCurrency: 'USD',
    settlements: [],
    shareIdentity: null,
    createdAt: t(),
    updatedAt: t(),
    ...p,
  };
}

const sum = (m: Map<string, number>) =>
  [...m.values()].reduce((a, b) => a + b, 0);

describe('computeOwed — equal split with penny remainder', () => {
  it('payer eats the leftover cent ($10 ÷ 3)', () => {
    const e = expense({
      amount: 1000,
      payers: [{ memberId: 'a', amount: 1000 }],
      splitMethod: 'equal',
      splits: [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 0 }, { memberId: 'c', value: 0 }],
    });
    const owed = computeOwed(e);
    expect(owed.get('a')).toBe(334); // payer absorbs the +1 remainder
    expect(owed.get('b')).toBe(333);
    expect(owed.get('c')).toBe(333);
    expect(sum(owed)).toBe(1000); // always exact
  });

  it('largest payer (then lowest id) absorbs the remainder with multiple payers', () => {
    const e = expense({
      amount: 1000,
      // b and c both paid 500; tie broken by id → b absorbs.
      payers: [{ memberId: 'c', amount: 500 }, { memberId: 'b', amount: 500 }],
      splitMethod: 'equal',
      splits: [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 0 }, { memberId: 'c', value: 0 }],
    });
    expect(absorbingPayer(e.payers)).toBe('b');
    const owed = computeOwed(e);
    expect(owed.get('b')).toBe(334);
    expect(owed.get('a')).toBe(333);
    expect(owed.get('c')).toBe(333);
  });
});

describe('computeOwed — other methods', () => {
  it('exact amounts are used verbatim, remainder (if any) to payer', () => {
    const e = expense({
      amount: 1000,
      payers: [{ memberId: 'a', amount: 1000 }],
      splitMethod: 'exact',
      splits: [{ memberId: 'a', value: 600 }, { memberId: 'b', value: 400 }],
    });
    const owed = computeOwed(e);
    expect(owed.get('a')).toBe(600);
    expect(owed.get('b')).toBe(400);
    expect(sum(owed)).toBe(1000);
  });

  it('shares/weights split proportionally', () => {
    const e = expense({
      amount: 900,
      payers: [{ memberId: 'a', amount: 900 }],
      splitMethod: 'shares',
      splits: [{ memberId: 'a', value: 2 }, { memberId: 'b', value: 1 }],
    });
    const owed = computeOwed(e);
    // a:2/3 → 600, b:1/3 → 300
    expect(owed.get('a')).toBe(600);
    expect(owed.get('b')).toBe(300);
    expect(sum(owed)).toBe(900);
  });

  it('percentages split proportionally', () => {
    const e = expense({
      amount: 1000,
      payers: [{ memberId: 'a', amount: 1000 }],
      splitMethod: 'percent',
      splits: [{ memberId: 'a', value: 70 }, { memberId: 'b', value: 30 }],
    });
    const owed = computeOwed(e);
    expect(owed.get('a')).toBe(700);
    expect(owed.get('b')).toBe(300);
    expect(sum(owed)).toBe(1000);
  });
});

describe('computeBalances', () => {
  it('one expense, equal split among 3 — payer owed, others owe', () => {
    const g = group({
      members: [member('a'), member('b'), member('c')],
      expenses: [
        expense({
          amount: 3000,
          payers: [{ memberId: 'a', amount: 3000 }],
          splits: [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 0 }, { memberId: 'c', value: 0 }],
        }),
      ],
    });
    const bal = computeBalances(g);
    expect(bal.get('a')).toBe(2000); // paid 3000, share 1000
    expect(bal.get('b')).toBe(-1000);
    expect(bal.get('c')).toBe(-1000);
    expect(sum(bal)).toBe(0);
  });

  it('balances always sum to zero across many expenses', () => {
    const g = group({
      members: [member('a'), member('b'), member('c')],
      expenses: [
        expense({ amount: 1000, payers: [{ memberId: 'a', amount: 1000 }], splits: [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 0 }, { memberId: 'c', value: 0 }] }),
        expense({ amount: 777, payers: [{ memberId: 'b', amount: 777 }], splits: [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 0 }, { memberId: 'c', value: 0 }] }),
        expense({ amount: 50, payers: [{ memberId: 'c', amount: 50 }], splits: [{ memberId: 'b', value: 0 }, { memberId: 'c', value: 0 }] }),
      ],
    });
    expect(sum(computeBalances(g))).toBe(0);
  });

  it('a settlement reduces the outstanding balance', () => {
    const settlement: Settlement = {
      id: 's1', fromMember: 'b', toMember: 'a', amount: 1000, currency: 'USD', rate: 1,
      method: 'cash', date: t(), createdAt: t(), updatedAt: t(),
    };
    const g = group({
      members: [member('a'), member('b'), member('c')],
      expenses: [expense({ amount: 3000, payers: [{ memberId: 'a', amount: 3000 }], splits: [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 0 }, { memberId: 'c', value: 0 }] })],
      settlements: [settlement],
    });
    const bal = computeBalances(g);
    expect(bal.get('a')).toBe(1000); // was owed 2000, b paid back 1000
    expect(bal.get('b')).toBe(0); // owed 1000, paid 1000 → settled
    expect(bal.get('c')).toBe(-1000);
    expect(sum(bal)).toBe(0);
  });

  it('ignores deleted expenses (tombstones)', () => {
    const g = group({
      members: [member('a'), member('b')],
      expenses: [
        expense({ amount: 1000, payers: [{ memberId: 'a', amount: 1000 }], splits: [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 0 }], deletedAt: t() }),
      ],
    });
    const bal = computeBalances(g);
    expect(bal.get('a')).toBe(0);
    expect(bal.get('b')).toBe(0);
  });
});

describe('computeSettlement — minimal transfers', () => {
  it('nets a chain into the fewest payments', () => {
    // a owed 2000, b owes 1000, c owes 1000 → two transfers to a.
    const bal = new Map([['a', 2000], ['b', -1000], ['c', -1000]]);
    const plan = computeSettlement(bal);
    expect(plan).toHaveLength(2);
    expect(plan.every((p) => p.to === 'a')).toBe(true);
    expect(plan.reduce((s, p) => s + p.amount, 0)).toBe(2000);
  });

  it('is deterministic regardless of map insertion order', () => {
    const a = new Map([['x', 500], ['y', -300], ['z', -200]]);
    const b = new Map([['z', -200], ['x', 500], ['y', -300]]);
    expect(computeSettlement(a)).toEqual(computeSettlement(b));
  });

  it('returns nothing when everyone is settled', () => {
    expect(computeSettlement(new Map([['a', 0], ['b', 0]]))).toEqual([]);
  });
});

describe('multi-currency', () => {
  it('converts at the at-entry-time rate and preserves zero-sum', () => {
    // Base USD; an expense in EUR (rate 1.1 USD per 1 EUR), €30 split 3 ways.
    const g = group({
      baseCurrency: 'USD',
      members: [member('a'), member('b'), member('c')],
      expenses: [
        expense({
          amount: 3000, currency: 'EUR', rate: 1.1,
          payers: [{ memberId: 'a', amount: 3000 }],
          splits: [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 0 }, { memberId: 'c', value: 0 }],
        }),
      ],
    });
    const bal = computeBalances(g);
    expect(sum(bal)).toBe(0); // the invariant survives conversion
    // a's net €2000 → ~$2200; b,c each −€1000 → ~−$1100.
    expect(bal.get('a')).toBe(2200);
    expect(bal.get('b')).toBe(-1100);
    expect(bal.get('c')).toBe(-1100);
  });

  it('a 0-decimal currency (JPY) into a 2-decimal base preserves zero-sum', () => {
    const g = group({
      baseCurrency: 'USD',
      members: [member('a'), member('b'), member('c')],
      expenses: [
        expense({
          amount: 1000, currency: 'JPY', rate: 0.0067, // ¥1000 ≈ $6.70
          payers: [{ memberId: 'a', amount: 1000 }],
          splits: [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 0 }, { memberId: 'c', value: 0 }],
        }),
      ],
    });
    expect(sum(computeBalances(g))).toBe(0);
  });
});

describe('computeMemberSummary', () => {
  it('shows paid, share, settled, and a net that matches the balance', () => {
    const g = group({
      members: [member('a'), member('b')],
      expenses: [expense({ amount: 1000, payers: [{ memberId: 'a', amount: 1000 }], splits: [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 0 }] })],
    });
    const s = computeMemberSummary(g, 'a');
    expect(s.paid).toBe(1000);
    expect(s.share).toBe(500);
    expect(s.net).toBe(500);
    expect(s.net).toBe(computeBalances(g).get('a'));
  });
});
