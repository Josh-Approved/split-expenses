// QA fixtures — the deterministic data the app boots with under QA_MODE (the
// capture pipeline builds with EXPO_PUBLIC_QA_MODE=1). One realistic group with
// people and a handful of expenses, plus the per-device "me" mapping so the
// balance header reads as a real, mid-trip ledger.
//
// Built as plain typed literals (not via the store constructors) so the data is
// fully deterministic — fixed ids and a frozen T0 epoch, never Date.now(). All
// amounts are integer MINOR UNITS (cents) in the expense's own currency, per
// data/types.ts and data/money.ts. Names/amounts chosen to fill each screen
// nicely and to give qa/selectors.json stable anchors.
//
// Wired in store/groups.ts hydrate(): under QA_MODE we seed this instead of
// loading from SQLite. QA_MODE is a compile-time constant, so production builds
// tree-shake this whole module away.

import type { Group, Member, Expense } from '../data/types';
import { MEMBER_COLORS } from '../data/avatars';

const T0 = 1700000000000; // fixed epoch — never Date.now() in fixtures
const day = 86_400_000;

const GROUP_ID = 'qa-group-lisbon';

// "me" — the first member; gives the balance header a non-zero, owed position.
const ALEX = 'qa-m-alex';
const SAM = 'qa-m-sam';
const MARIA = 'qa-m-maria';
const THEO = 'qa-m-theo';

const members: Member[] = [
  { id: ALEX, displayName: 'Alex', color: MEMBER_COLORS[0], createdAt: T0, updatedAt: T0 },
  { id: SAM, displayName: 'Sam', color: MEMBER_COLORS[1], createdAt: T0, updatedAt: T0 },
  { id: MARIA, displayName: 'Maria', color: MEMBER_COLORS[2], createdAt: T0, updatedAt: T0 },
  { id: THEO, displayName: 'Theo', color: MEMBER_COLORS[3], createdAt: T0, updatedAt: T0 },
];

const ALL = [ALEX, SAM, MARIA, THEO];
const equalSplit = ALL.map((memberId) => ({ memberId, value: 0 }));

/** One expense paid in full by `payer`, split equally among everyone (USD). */
function expense(
  id: string,
  description: string,
  amount: number,
  category: string,
  payer: string,
  daysAgo: number,
): Expense {
  const ts = T0 - daysAgo * day;
  return {
    id,
    description,
    amount,
    currency: 'USD',
    rate: 1,
    payers: [{ memberId: payer, amount }],
    splitMethod: 'equal',
    splits: equalSplit,
    category,
    date: ts,
    createdAt: ts,
    updatedAt: ts,
  };
}

const expenses: Expense[] = [
  expense('qa-e-airbnb', 'Airbnb in Lisbon', 96000, 'lodging', ALEX, 6),
  expense('qa-e-dinner', 'Dinner at Time Out Market', 13240, 'food', MARIA, 4),
  expense('qa-e-sintra', 'Train to Sintra', 4400, 'transport', SAM, 3),
  expense('qa-e-market', 'Groceries for the flat', 6790, 'groceries', THEO, 2),
  expense('qa-e-museum', 'Museum tickets', 4800, 'entertainment', ALEX, 1),
];

const group: Group = {
  id: GROUP_ID,
  name: 'Lisbon trip',
  baseCurrency: 'USD',
  members,
  expenses,
  settlements: [],
  shareIdentity: null,
  createdAt: T0 - 7 * day,
  updatedAt: T0 - 1 * day,
};

/** The full QA seed: the group list plus the per-device "me" mapping. */
export function qaSeed(): { groups: Group[]; me: Record<string, string> } {
  return { groups: [group], me: { [GROUP_ID]: ALEX } };
}
