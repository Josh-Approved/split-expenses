/**
 * Regression: the clock-skew failure modes are fixed for shared groups.
 *
 * Models two paired devices, each with its OWN logical clock (one phone an hour
 * fast), editing an expense and exchanging whole-group copies through the real
 * `mergeGroup` — exactly the engine's data path. Before this fix a stale edit
 * from the fast phone beat a fresh one and a deleted expense could reappear;
 * the asserts pin the corrected behaviour.
 */
import { LogicalClock } from '../clock';
import { mergeGroup } from '../mergeGroup';
import type { Expense, Group } from '../../data/types';

const SECRET = 'shared-secret-xyz';
const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

let real = T0;

function maxTs(g: Group): number {
  let m = Math.max(g.updatedAt, g.createdAt);
  for (const r of [...g.members, ...g.expenses, ...g.settlements]) {
    m = Math.max(m, r.updatedAt, r.deletedAt ?? 0);
  }
  return m;
}

class Device {
  group: Group;
  readonly clock: LogicalClock;
  constructor(label: string, skewMs: number) {
    this.clock = new LogicalClock({ physicalNow: () => real + skewMs });
    const at = this.clock.now();
    this.group = {
      id: `g_${label}`,
      name: 'Trip',
      baseCurrency: 'USD',
      members: [],
      expenses: [],
      settlements: [],
      shareIdentity: { secret: SECRET, createdAt: at },
      createdAt: at,
      updatedAt: at,
    };
  }

  /** Upsert an expense (create or edit `amount`), stamped with this clock. */
  setExpense(id: string, amount: number): void {
    const at = this.clock.now();
    const existing = this.group.expenses.find((e) => e.id === id);
    const base: Expense = existing ?? {
      id,
      description: id,
      amount,
      currency: 'USD',
      rate: 1,
      payers: [],
      splitMethod: 'equal',
      splits: [],
      category: 'other',
      date: at,
      createdAt: at,
      updatedAt: at,
    };
    const next: Expense = { ...base, amount, updatedAt: at, deletedAt: undefined };
    const expenses = existing
      ? this.group.expenses.map((e) => (e.id === id ? next : e))
      : [...this.group.expenses, next];
    this.group = { ...this.group, expenses, updatedAt: at };
  }

  delete(id: string): void {
    const at = this.clock.now();
    this.group = {
      ...this.group,
      updatedAt: at,
      expenses: this.group.expenses.map((e) =>
        e.id === id ? { ...e, deletedAt: at, updatedAt: at } : e,
      ),
    };
  }

  receive(remote: Group): void {
    this.clock.observe(maxTs(remote));
    this.group = mergeGroup(this.group, remote);
  }

  amount(id: string): number | 'GONE' {
    const e = this.group.expenses.find((x) => x.id === id && x.deletedAt == null);
    return e ? e.amount : 'GONE';
  }
}

beforeEach(() => {
  real = T0;
});

test('a fresh edit beats a stale edit from the fast phone (no lost edits)', () => {
  const fast = new Device('fast', HOUR);
  const ok = new Device('ok', 0);

  fast.setExpense('dinner', 4000); // $40, stamped at fast's +1h clock
  ok.receive(fast.group); // ok now has it, clock lifted past fast's stamp
  expect(ok.amount('dinner')).toBe(4000);

  real += 60_000;
  ok.setExpense('dinner', 4200); // correct $42 a minute later

  fast.receive(ok.group);
  expect(ok.amount('dinner')).toBe(4200);
  expect(fast.amount('dinner')).toBe(4200); // the later edit wins on both
});

test('a re-added expense stays put — no disappear/reappear flapping', () => {
  const fast = new Device('fast', HOUR);
  const ok = new Device('ok', 0);

  fast.setExpense('taxi', 2000);
  ok.receive(fast.group);

  fast.delete('taxi');
  ok.receive(fast.group);
  expect(ok.amount('taxi')).toBe('GONE');

  real += 120_000;
  ok.setExpense('taxi', 2000); // user re-adds it
  fast.receive(ok.group);
  expect(ok.amount('taxi')).toBe(2000);
  expect(fast.amount('taxi')).toBe(2000);
});

test('independent expenses from both devices both survive a merge', () => {
  const a = new Device('a', HOUR);
  const b = new Device('b', 0);
  a.setExpense('eggs', 500);
  b.setExpense('bread', 300);
  b.receive(a.group);
  a.receive(b.group);
  for (const d of [a, b]) {
    expect(d.amount('eggs')).toBe(500);
    expect(d.amount('bread')).toBe(300);
  }
});
