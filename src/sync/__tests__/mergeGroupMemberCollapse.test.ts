/**
 * Regression: two devices adding the SAME PERSON while offline must end up with
 * one member, not two.
 *
 * Before the collapse, "Sam" typed on two paired phones minted two member ids
 * and an id-keyed union kept both forever — that person's expenses split across
 * two identical-looking rows and every balance in the group came out wrong,
 * silently. grocery-list and packing-list have collapsed duplicate names since
 * launch; this is the split-expenses cousin, plus the part the list apps don't
 * need: expenses and settlements reference members by id, so folding two
 * members together has to re-point every reference too.
 *
 * The tests below run BOTH merge orders (device A computes mergeGroup(a, b),
 * device B computes mergeGroup(b, a)) wherever convergence is the claim — a
 * collapse that picked "whichever the local device had" would pass a one-order
 * test and diverge in the field.
 */
import { mergeGroup, normalizeMemberName, resolveMemberId } from '../mergeGroup';
import { computeBalances } from '../../math/balances';
import type { Expense, Group, Member, Settlement } from '../../data/types';

const SECRET = 'shared-secret-member-collapse';
const T0 = 1_700_000_000_000;

function member(id: string, displayName: string, at: number, extra: Partial<Member> = {}): Member {
  return { id, displayName, createdAt: at, updatedAt: at, ...extra };
}

function expense(
  id: string,
  at: number,
  payers: Expense['payers'],
  splits: Expense['splits'],
  extra: Partial<Expense> = {},
): Expense {
  return {
    id,
    description: 'Dinner',
    amount: payers.reduce((a, p) => a + p.amount, 0),
    currency: 'USD',
    rate: 1,
    payers,
    splitMethod: 'exact',
    splits,
    category: 'food',
    date: at,
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

function settlement(
  id: string,
  at: number,
  fromMember: string,
  toMember: string,
  amount: number,
  extra: Partial<Settlement> = {},
): Settlement {
  return {
    id,
    fromMember,
    toMember,
    amount,
    currency: 'USD',
    rate: 1,
    method: 'cash',
    date: at,
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

function group(id: string, parts: Partial<Group> = {}): Group {
  return {
    id,
    name: 'Ski trip',
    baseCurrency: 'USD',
    members: [],
    expenses: [],
    settlements: [],
    shareIdentity: { secret: SECRET, createdAt: T0 },
    createdAt: T0,
    updatedAt: T0,
    ...parts,
  };
}

const live = (g: Group) => g.members.filter((m) => m.deletedAt == null);
const byId = (g: Group, id: string) => g.members.find((m) => m.id === id);
const ex = (g: Group, id: string) => g.expenses.find((e) => e.id === id)!;
const st = (g: Group, id: string) => g.settlements.find((s) => s.id === id)!;

// --- the defect ------------------------------------------------------------

test('two offline devices adding the same person collapse to ONE member', () => {
  // Both phones added "Sam" while apart; different ids, different instants.
  const a = group('g_a', { members: [member('m_a', 'Sam', T0 + 100)] });
  const b = group('g_b', { members: [member('m_b', 'Sam', T0 + 200)] });

  const merged = mergeGroup(a, b);

  expect(live(merged).map((m) => m.displayName)).toEqual(['Sam']);
  // The loser is tombstoned, not dropped — the tombstone is what retires it on
  // every other device, and it carries the forwarding pointer.
  const dead = merged.members.filter((m) => m.deletedAt != null);
  expect(dead).toHaveLength(1);
  expect(dead[0].mergedInto).toBe(live(merged)[0].id);
});

test('both devices pick the SAME survivor, in either merge order', () => {
  const a = group('g_a', { members: [member('m_a', 'Sam', T0 + 100)] });
  const b = group('g_b', { members: [member('m_b', 'Sam', T0 + 200)] });

  const onA = mergeGroup(a, b);
  const onB = mergeGroup(b, a);

  expect(live(onA).map((m) => m.id)).toEqual(live(onB).map((m) => m.id));
  // Freshest wins: the newest add is the current intent.
  expect(live(onA)[0].id).toBe('m_b');
});

test('an updatedAt tie still converges (createdAt, then id, break it)', () => {
  // Same millisecond on both phones — the case a "keep local" rule diverges on.
  const a = group('g_a', { members: [member('m_a', 'Sam', T0 + 100)] });
  const b = group('g_b', { members: [member('m_b', 'sam ', T0 + 100)] });

  const onA = mergeGroup(a, b);
  const onB = mergeGroup(b, a);

  expect(live(onA)).toHaveLength(1);
  expect(live(onA)[0].id).toBe(live(onB)[0].id);
});

test('name matching is trim + case insensitive, and shared with the normalizer', () => {
  expect(normalizeMemberName('  Sam ')).toBe(normalizeMemberName('sam'));

  const a = group('g_a', { members: [member('m_a', 'Sam', T0 + 100)] });
  const b = group('g_b', { members: [member('m_b', '  SAM  ', T0 + 200)] });

  expect(live(mergeGroup(a, b))).toHaveLength(1);
});

// --- foreign-key remap -----------------------------------------------------

test("expenses naming the folded member are re-pointed at the survivor", () => {
  // A logged a dinner paid by its own Sam; B logged one paid by its own Sam.
  const a = group('g_a', {
    members: [member('m_a', 'Sam', T0 + 100), member('m_x', 'Ada', T0 + 50)],
    expenses: [
      expense(
        'e_a',
        T0 + 300,
        [{ memberId: 'm_a', amount: 1000 }],
        [
          { memberId: 'm_a', value: 500 },
          { memberId: 'm_x', value: 500 },
        ],
      ),
    ],
  });
  const b = group('g_b', {
    members: [member('m_b', 'Sam', T0 + 200), member('m_x', 'Ada', T0 + 50)],
  });

  const onA = mergeGroup(a, b);
  const onB = mergeGroup(b, a);

  const keeper = live(onA).find((m) => m.displayName === 'Sam')!.id;
  expect(keeper).toBe('m_b');
  for (const merged of [onA, onB]) {
    expect(ex(merged, 'e_a').payers).toEqual([{ memberId: keeper, amount: 1000 }]);
    expect(ex(merged, 'e_a').splits).toEqual([
      { memberId: keeper, value: 500 },
      { memberId: 'm_x', value: 500 },
    ]);
  }
});

test('settlements naming the folded member are re-pointed at the survivor', () => {
  const a = group('g_a', {
    members: [member('m_a', 'Sam', T0 + 100), member('m_x', 'Ada', T0 + 50)],
    settlements: [settlement('s_1', T0 + 300, 'm_x', 'm_a', 750)],
  });
  const b = group('g_b', { members: [member('m_b', 'Sam', T0 + 200)] });

  const merged = mergeGroup(a, b);

  expect(st(merged, 's_1').fromMember).toBe('m_x');
  expect(st(merged, 's_1').toMember).toBe('m_b');
});

test('a settlement whose two ends collapse into one person is voided', () => {
  // "Sam paid Sam" is not a payment — it is the duplicate showing through.
  const a = group('g_a', {
    members: [member('m_a', 'Sam', T0 + 100)],
    settlements: [settlement('s_1', T0 + 300, 'm_a', 'm_b', 750)],
  });
  const b = group('g_b', { members: [member('m_b', 'Sam', T0 + 200)] });

  const merged = mergeGroup(a, b);

  expect(st(merged, 's_1').deletedAt).toBe(T0 + 300);
});

test('an expense naming BOTH duplicates ends with ONE entry for that person', () => {
  // The nastiest shape: someone entered a dinner where "Sam" (this phone's) and
  // "Sam" (the other phone's) both appear. Two entries for one member id would
  // make the split math drop a share silently — they must fold into one.
  const a = group('g_a', {
    members: [member('m_a', 'Sam', T0 + 100), member('m_b', 'Sam', T0 + 200)],
    expenses: [
      expense(
        'e_1',
        T0 + 300,
        [
          { memberId: 'm_a', amount: 600 },
          { memberId: 'm_b', amount: 400 },
        ],
        [
          { memberId: 'm_a', value: 700 },
          { memberId: 'm_b', value: 300 },
        ],
      ),
    ],
  });

  const merged = mergeGroup(a, group('g_b'));

  expect(ex(merged, 'e_1').payers).toEqual([{ memberId: 'm_b', amount: 1000 }]);
  expect(ex(merged, 'e_1').splits).toEqual([{ memberId: 'm_b', value: 1000 }]);
  // And the money still balances: one person paid the whole thing and owes it.
  expect(computeBalances(merged).get('m_b')).toBe(0);
});

test('balances land on the survivor instead of splitting across two rows', () => {
  // The user-visible defect: Ada owes Sam 500, but the debt is recorded against
  // whichever Sam that phone knew about.
  const a = group('g_a', {
    members: [member('m_a', 'Sam', T0 + 100), member('m_x', 'Ada', T0 + 50)],
    expenses: [
      expense(
        'e_a',
        T0 + 300,
        [{ memberId: 'm_a', amount: 1000 }],
        [
          { memberId: 'm_a', value: 500 },
          { memberId: 'm_x', value: 500 },
        ],
      ),
    ],
  });
  const b = group('g_b', {
    members: [member('m_b', 'Sam', T0 + 200), member('m_x', 'Ada', T0 + 50)],
    expenses: [
      expense(
        'e_b',
        T0 + 400,
        [{ memberId: 'm_b', amount: 1000 }],
        [
          { memberId: 'm_b', value: 500 },
          { memberId: 'm_x', value: 500 },
        ],
      ),
    ],
  });

  const balances = computeBalances(mergeGroup(a, b));

  expect(balances.get('m_b')).toBe(1000); // both dinners credited to one Sam
  expect(balances.get('m_x')).toBe(-1000);
  expect(balances.get('m_a')).toBeUndefined(); // the folded id is gone entirely
});

// --- durability of the fold ------------------------------------------------

test('a stale un-remapped expense replayed later is re-pointed again', () => {
  // Device C replays an OLD drop-box message that still names the folded id.
  // The forwarding pointer on the tombstone is what saves it: without one, the
  // expense strands on a member nobody can see.
  const a = group('g_a', {
    members: [member('m_a', 'Sam', T0 + 100)],
    expenses: [expense('e_1', T0 + 300, [{ memberId: 'm_a', amount: 1000 }], [{ memberId: 'm_a', value: 1000 }])],
  });
  const b = group('g_b', { members: [member('m_b', 'Sam', T0 + 200)] });
  const converged = mergeGroup(a, b);
  expect(ex(converged, 'e_1').payers[0].memberId).toBe('m_b');

  const replayed = mergeGroup(converged, a);

  expect(ex(replayed, 'e_1').payers).toEqual([{ memberId: 'm_b', amount: 1000 }]);
  expect(live(replayed)).toHaveLength(1);
});

test('an edit made on a device that never saw the fold is re-pointed', () => {
  // Worse than a replay: a genuinely NEWER edit, so it wins the record merge on
  // the clock and arrives still naming the folded member.
  const a = group('g_a', {
    members: [member('m_a', 'Sam', T0 + 100)],
    expenses: [expense('e_1', T0 + 300, [{ memberId: 'm_a', amount: 1000 }], [{ memberId: 'm_a', value: 1000 }])],
  });
  const b = group('g_b', { members: [member('m_b', 'Sam', T0 + 200)] });
  const converged = mergeGroup(a, b);

  const offlineEdit = group('g_c', {
    members: a.members,
    expenses: [
      expense('e_1', T0 + 900, [{ memberId: 'm_a', amount: 2500 }], [{ memberId: 'm_a', value: 2500 }], {
        description: 'Dinner (corrected)',
      }),
    ],
  });
  const merged = mergeGroup(converged, offlineEdit);

  expect(ex(merged, 'e_1').description).toBe('Dinner (corrected)'); // the edit survived
  expect(ex(merged, 'e_1').payers).toEqual([{ memberId: 'm_b', amount: 2500 }]);
});

test('the collapse is idempotent — re-merging changes nothing', () => {
  const a = group('g_a', {
    members: [member('m_a', 'Sam', T0 + 100)],
    expenses: [expense('e_1', T0 + 300, [{ memberId: 'm_a', amount: 1000 }], [{ memberId: 'm_a', value: 1000 }])],
    settlements: [settlement('s_1', T0 + 320, 'm_a', 'm_x', 200)],
  });
  const b = group('g_b', { members: [member('m_b', 'Sam', T0 + 200), member('m_x', 'Ada', T0 + 50)] });

  const once = mergeGroup(a, b);
  const twice = mergeGroup(once, once);

  expect(twice).toEqual(once);
});

test('a chain of folds resolves to the final survivor', () => {
  // Three phones, three Sams, folded in two passes.
  const a = group('g_a', { members: [member('m_a', 'Sam', T0 + 100)] });
  const b = group('g_b', { members: [member('m_b', 'Sam', T0 + 200)] });
  const c = group('g_c', {
    members: [member('m_c', 'Sam', T0 + 300)],
    expenses: [expense('e_1', T0 + 400, [{ memberId: 'm_a', amount: 500 }], [{ memberId: 'm_a', value: 500 }])],
  });

  const merged = mergeGroup(mergeGroup(a, b), c);

  expect(live(merged).map((m) => m.id)).toEqual(['m_c']);
  expect(ex(merged, 'e_1').payers).toEqual([{ memberId: 'm_c', amount: 500 }]);
  expect(resolveMemberId(merged.members, 'm_a')).toBe('m_c');
});

// --- what must NOT happen --------------------------------------------------

test('distinct names are left completely untouched', () => {
  const a = group('g_a', {
    members: [member('m_a', 'Sam', T0 + 100), member('m_x', 'Ada', T0 + 50)],
    expenses: [
      expense(
        'e_1',
        T0 + 300,
        [{ memberId: 'm_a', amount: 1000 }],
        [
          { memberId: 'm_a', value: 500 },
          { memberId: 'm_x', value: 500 },
        ],
      ),
    ],
  });
  const b = group('g_b', { members: [member('m_y', 'Kai', T0 + 200)] });

  const merged = mergeGroup(a, b);

  expect(live(merged).map((m) => m.id).sort()).toEqual(['m_a', 'm_x', 'm_y']);
  expect(merged.members.every((m) => m.mergedInto == null)).toBe(true);
  expect(ex(merged, 'e_1')).toBe(a.expenses[0]); // not even rewritten
});

test('a removed member is never resurrected by a same-named live one', () => {
  // Ada was removed on purpose. A live "Ada" elsewhere must not bring her back,
  // and must not inherit keepership from a tombstone.
  const a = group('g_a', {
    members: [member('m_a', 'Ada', T0 + 100, { deletedAt: T0 + 500, updatedAt: T0 + 500 })],
  });
  const b = group('g_b', { members: [member('m_b', 'Ada', T0 + 200)] });

  const onA = mergeGroup(a, b);
  const onB = mergeGroup(b, a);

  for (const merged of [onA, onB]) {
    expect(live(merged).map((m) => m.id)).toEqual(['m_b']);
    expect(byId(merged, 'm_a')!.deletedAt).toBe(T0 + 500);
    // A plain removal is NOT a fold: it leaves no forwarding pointer, so a
    // deliberately-removed person's history is never re-attributed.
    expect(byId(merged, 'm_a')!.mergedInto).toBeUndefined();
  }
});

test("a removed member's expenses stay with them, not with a same-named live one", () => {
  const removed = member('m_a', 'Ada', T0 + 100, { deletedAt: T0 + 500, updatedAt: T0 + 500 });
  const a = group('g_a', {
    members: [removed],
    expenses: [expense('e_1', T0 + 300, [{ memberId: 'm_a', amount: 900 }], [{ memberId: 'm_a', value: 900 }])],
  });
  const b = group('g_b', { members: [member('m_b', 'Ada', T0 + 600)] });

  const merged = mergeGroup(a, b);

  expect(ex(merged, 'e_1').payers).toEqual([{ memberId: 'm_a', amount: 900 }]);
});

test('two tombstoned same-name members are left alone', () => {
  const a = group('g_a', {
    members: [
      member('m_a', 'Sam', T0 + 100, { deletedAt: T0 + 400, updatedAt: T0 + 400 }),
      member('m_b', 'Sam', T0 + 200, { deletedAt: T0 + 500, updatedAt: T0 + 500 }),
    ],
  });

  const merged = mergeGroup(a, group('g_b'));

  expect(live(merged)).toHaveLength(0);
  expect(merged.members.every((m) => m.mergedInto == null)).toBe(true);
});

test('tombstoned expenses and settlements are not rewritten', () => {
  const deadExpense = expense(
    'e_dead',
    T0 + 300,
    [{ memberId: 'm_a', amount: 1000 }],
    [{ memberId: 'm_a', value: 1000 }],
    { deletedAt: T0 + 350 },
  );
  const deadSettlement = settlement('s_dead', T0 + 300, 'm_a', 'm_x', 200, { deletedAt: T0 + 350 });
  const a = group('g_a', {
    members: [member('m_a', 'Sam', T0 + 100)],
    expenses: [deadExpense],
    settlements: [deadSettlement],
  });
  const b = group('g_b', { members: [member('m_b', 'Sam', T0 + 200)] });

  const merged = mergeGroup(a, b);

  expect(ex(merged, 'e_dead')).toBe(deadExpense);
  expect(st(merged, 's_dead')).toBe(deadSettlement);
});

test('a blank display name carries no identity and never groups', () => {
  const a = group('g_a', {
    members: [member('m_a', '', T0 + 100), member('m_b', '   ', T0 + 200)],
  });

  const merged = mergeGroup(a, group('g_b'));

  expect(live(merged)).toHaveLength(2);
});

test('resolveMemberId leaves an unfolded id alone', () => {
  const members = [member('m_a', 'Sam', T0 + 100)];
  expect(resolveMemberId(members, 'm_a')).toBe('m_a');
  expect(resolveMemberId(members, 'm_gone')).toBe('m_gone');
});
