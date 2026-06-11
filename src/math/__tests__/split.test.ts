/**
 * Per-expense split math — the trust core at the single-expense level.
 *
 * balances.test.ts pins the group-level worked examples; this file pins the
 * lower-level split.ts behaviour a refactor would silently break: the absorbing
 * payer, the penny-remainder direction per method, the degenerate-weights
 * fallback, the exact-method over/under remainder, and the validation helpers.
 *
 * Structure mirrors balances.test.ts (same factories, same `sum` invariant).
 */

import type { Expense, Payer } from '../../data/types';
import {
  computeOwed,
  computePaid,
  absorbingPayer,
  payersTotal,
  exactSplitTotal,
} from '../split';

let seq = 0;
const t = () => ++seq;

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

const sum = (m: Map<string, number>) =>
  [...m.values()].reduce((a, b) => a + b, 0);

describe('absorbingPayer — who eats the remainder', () => {
  it('is null when there are no payers', () => {
    expect(absorbingPayer([])).toBeNull();
  });

  it('is the sole payer when there is one', () => {
    expect(absorbingPayer([{ memberId: 'a', amount: 500 }])).toBe('a');
  });

  it('is the largest payer', () => {
    const payers: Payer[] = [
      { memberId: 'a', amount: 300 },
      { memberId: 'b', amount: 700 },
    ];
    expect(absorbingPayer(payers)).toBe('b');
  });

  it('breaks ties by lowest member id', () => {
    const payers: Payer[] = [
      { memberId: 'z', amount: 500 },
      { memberId: 'a', amount: 500 },
      { memberId: 'm', amount: 500 },
    ];
    expect(absorbingPayer(payers)).toBe('a');
  });
});

describe('computeOwed — equal split, single & two members', () => {
  it('a single member owes the whole amount', () => {
    const e = expense({
      amount: 1000,
      payers: [{ memberId: 'a', amount: 1000 }],
      splitMethod: 'equal',
      splits: [{ memberId: 'a', value: 0 }],
    });
    const owed = computeOwed(e);
    expect(owed.get('a')).toBe(1000);
    expect(sum(owed)).toBe(1000);
  });

  it('an even two-way split needs no remainder', () => {
    const e = expense({
      amount: 1000,
      payers: [{ memberId: 'a', amount: 1000 }],
      splitMethod: 'equal',
      splits: [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 0 }],
    });
    const owed = computeOwed(e);
    expect(owed.get('a')).toBe(500);
    expect(owed.get('b')).toBe(500);
    expect(sum(owed)).toBe(1000);
  });

  it('the remainder always lands on the absorbing payer, even when the payer is not in the split', () => {
    // c pays; the cost is split equally among a & b only. $10.01 / 2 = 500/501
    // with a +1 remainder — and that remainder goes to the PAYER (c), who then
    // appears in `owed` despite not being a participant in the split.
    const e = expense({
      amount: 1001,
      payers: [{ memberId: 'c', amount: 1001 }],
      splitMethod: 'equal',
      splits: [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 0 }],
    });
    const owed = computeOwed(e);
    expect(owed.get('a')).toBe(500);
    expect(owed.get('b')).toBe(500);
    expect(owed.get('c')).toBe(1); // payer absorbs the leftover cent
    expect(sum(owed)).toBe(1001);
  });
});

describe('computeOwed — percent rounding to the cent', () => {
  it('absorbs the rounding remainder on the payer and stays exact', () => {
    // 33.33% / 33.33% / 33.34% of $10.00 → floors to 333/333/333 = 999, the
    // +1 remainder goes to the payer (a).
    const e = expense({
      amount: 1000,
      payers: [{ memberId: 'a', amount: 1000 }],
      splitMethod: 'percent',
      splits: [
        { memberId: 'a', value: 33.33 },
        { memberId: 'b', value: 33.33 },
        { memberId: 'c', value: 33.34 },
      ],
    });
    const owed = computeOwed(e);
    expect(sum(owed)).toBe(1000); // exact, always
    expect(owed.get('b')).toBe(333);
    expect(owed.get('c')).toBe(333);
    expect(owed.get('a')).toBe(334); // payer carries the +1
  });
});

describe('computeOwed — exact method over/under total', () => {
  it('routes a SHORTFALL (entered amounts < total) to the payer', () => {
    // Entered shares sum to 900 but the expense is 1000 → +100 to the payer.
    const e = expense({
      amount: 1000,
      payers: [{ memberId: 'a', amount: 1000 }],
      splitMethod: 'exact',
      splits: [{ memberId: 'a', value: 400 }, { memberId: 'b', value: 500 }],
    });
    const owed = computeOwed(e);
    expect(owed.get('a')).toBe(500); // 400 entered + 100 remainder
    expect(owed.get('b')).toBe(500);
    expect(sum(owed)).toBe(1000);
  });

  it('routes an OVERAGE (entered amounts > total) to the payer as a negative nudge', () => {
    // Entered shares sum to 1100 but the expense is 1000 → −100 to the payer.
    const e = expense({
      amount: 1000,
      payers: [{ memberId: 'a', amount: 1000 }],
      splitMethod: 'exact',
      splits: [{ memberId: 'a', value: 600 }, { memberId: 'b', value: 500 }],
    });
    const owed = computeOwed(e);
    expect(owed.get('a')).toBe(500); // 600 entered − 100 remainder
    expect(owed.get('b')).toBe(500);
    expect(sum(owed)).toBe(1000);
  });
});

describe('computeOwed — degenerate inputs', () => {
  it('all-zero weights fall back to an equal split (expense still balances)', () => {
    // shares method with every weight 0 → totalWeight <= 0 → equal fallback.
    // floor(1000/3) = 333 each = 999, then +1 remainder to the payer.
    const e = expense({
      amount: 1000,
      payers: [{ memberId: 'a', amount: 1000 }],
      splitMethod: 'shares',
      splits: [
        { memberId: 'a', value: 0 },
        { memberId: 'b', value: 0 },
        { memberId: 'c', value: 0 },
      ],
    });
    const owed = computeOwed(e);
    expect(sum(owed)).toBe(1000); // never vanishes
    expect(owed.get('b')).toBe(333);
    expect(owed.get('c')).toBe(333);
    expect(owed.get('a')).toBe(334);
  });

  it('an empty split assigns the whole amount to the payer (expense never vanishes)', () => {
    // No participants entered yet: rawShares is empty, so the full amount is
    // remainder and lands on the absorbing payer — the cost is never lost.
    const e = expense({
      amount: 1000,
      payers: [{ memberId: 'a', amount: 1000 }],
      splitMethod: 'equal',
      splits: [],
    });
    const owed = computeOwed(e);
    expect(owed.get('a')).toBe(1000);
    expect(sum(owed)).toBe(1000);
  });
});

describe('computePaid — aggregates per member', () => {
  it('sums repeated payer entries for the same member', () => {
    const e = expense({
      amount: 1000,
      payers: [
        { memberId: 'a', amount: 600 },
        { memberId: 'a', amount: 400 },
      ],
      splits: [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 0 }],
    });
    const paid = computePaid(e);
    expect(paid.get('a')).toBe(1000);
    expect(paid.size).toBe(1);
  });

  it('keeps distinct payers separate and sums to the total', () => {
    const e = expense({
      amount: 1000,
      payers: [
        { memberId: 'a', amount: 700 },
        { memberId: 'b', amount: 300 },
      ],
      splits: [{ memberId: 'a', value: 0 }, { memberId: 'b', value: 0 }],
    });
    const paid = computePaid(e);
    expect(paid.get('a')).toBe(700);
    expect(paid.get('b')).toBe(300);
    expect(sum(paid)).toBe(1000);
  });
});

describe('validation helpers the editor uses', () => {
  it('payersTotal sums payer amounts (0 for none)', () => {
    expect(payersTotal([])).toBe(0);
    expect(
      payersTotal([
        { memberId: 'a', amount: 600 },
        { memberId: 'b', amount: 400 },
      ]),
    ).toBe(1000);
  });

  it('exactSplitTotal rounds each entered value before summing', () => {
    expect(
      exactSplitTotal([
        { memberId: 'a', value: 333.4 },
        { memberId: 'b', value: 333.5 },
      ]),
    ).toBe(333 + 334);
  });
});
