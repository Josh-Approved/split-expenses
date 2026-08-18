/**
 * `mergeRecordSet` is the trust core underneath every shared group — this suite
 * pins the CRDT properties canon § Backup & restore #5 promises. A bug here
 * silently loses or resurrects a household's expenses, members and settlements
 * across devices, so we test the real LWW-element-set-with-tombstones
 * semantics, not a happy path:
 *
 *   • newer edit wins over older edit (last-write-wins by clock)
 *   • a tombstone out-clocks an older edit (delete wins) BUT a genuinely newer
 *     edit out-clocks an older tombstone (resurrection only when legitimately
 *     newer — a re-added expense)
 *   • commutative: merge(a,b) ≡ merge(b,a)  (best-effort transport can reorder)
 *   • idempotent: merge(a,a) ≡ a            (re-publishing must not drift)
 *   • concurrent disjoint adds both survive
 *   • tie-break determinism: two devices stamping the same millisecond must
 *     converge to ONE copy, on both devices
 *   • empty / one-sided merges
 *
 * `mergeRecordSet.ts` is an overwrite-synced shared-sync file, so this mirrors
 * the fleet exemplar (grocery-list's `mergeRecordSet.test.ts`) and tests the
 * shared primitive DIRECTLY. This app's own wrapper (`mergeGroup`) is covered
 * separately by mergeGroupTiebreak / mergeGroupMemberCollapse — the point here
 * is that the shared file is pinned in this repo too, so a bad re-sync is
 * caught by this app's own gate rather than only a sibling's.
 *
 * mergeRecordSet returns an array in undefined order, so every comparison
 * sorts by id first.
 */

import { mergeRecordSet, type Record } from '../mergeRecordSet';

// A minimal record satisfying the merge contract. Real timestamps (ms epoch).
type Rec = Record & { name?: string; amount?: number };

const T0 = 1_700_000_000_000; // a real ms-epoch baseline
const rec = (id: string, updatedAt: number, extra: Partial<Rec> = {}): Rec => ({
  id,
  updatedAt,
  ...extra,
});
const tomb = (id: string, updatedAt: number, deletedAt: number, extra: Partial<Rec> = {}): Rec => ({
  id,
  updatedAt,
  deletedAt,
  ...extra,
});

const byId = <T extends Record>(xs: T[]): T[] =>
  [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Deep-equal-after-sort, the only meaningful equality for an unordered set. */
const sameSet = <T extends Record>(a: T[], b: T[]) => expect(byId(a)).toEqual(byId(b));

const get = <T extends Record>(xs: T[], id: string): T | undefined => xs.find((r) => r.id === id);

// ---------------------------------------------------------------------------
// Last-write-wins by clock
// ---------------------------------------------------------------------------

describe('mergeRecordSet — last-write-wins by clock', () => {
  it('the newer edit wins over the older edit, regardless of side', () => {
    const old = rec('x', T0, { name: 'Dinner' });
    const fresh = rec('x', T0 + 1000, { name: 'Dinner + tip' });

    expect(get(mergeRecordSet([old], [fresh]), 'x')).toEqual(fresh);
    // and the other way round — the newer one still wins
    expect(get(mergeRecordSet([fresh], [old]), 'x')).toEqual(fresh);
  });

  it('on an exact updatedAt tie between two live edits, BOTH merge orders pick the same copy', () => {
    const left = rec('x', T0, { name: 'A' });
    const right = rec('x', T0, { name: 'B' });
    // The contract: a tie between two live edits resolves by CONTENT (stable
    // key-sorted serialization), identically on every device. The old
    // "keep whichever copy is local" rule meant two phones that stamped the
    // same millisecond each kept their own copy — divergent forever.
    const ab = get(mergeRecordSet([left], [right]), 'x');
    const ba = get(mergeRecordSet([right], [left]), 'x');
    expect(ab).toEqual(ba);
    expect([left, right]).toContainEqual(ab);
  });
});

// ---------------------------------------------------------------------------
// Tombstones — delete wins, resurrection only when legitimately newer
// ---------------------------------------------------------------------------

describe('mergeRecordSet — tombstone (deletion) semantics', () => {
  it('a tombstone beats an OLDER live edit (delete wins — the expense stays gone)', () => {
    const edit = rec('x', T0, { name: 'Taxi' });
    const deletion = tomb('x', T0, T0 + 5000); // deleted after the edit
    const out = get(mergeRecordSet([edit], [deletion]), 'x');
    expect(out?.deletedAt).toBe(T0 + 5000);
    sameSet(mergeRecordSet([edit], [deletion]), mergeRecordSet([deletion], [edit]));
  });

  it("a tombstone's clock is max(updatedAt, deletedAt) — a stale-updatedAt delete still out-clocks the edit", () => {
    // The delete was authored with an old updatedAt but a fresh deletedAt;
    // the effective clock must be the deletedAt, so the delete wins.
    const edit = rec('x', T0 + 2000, { name: 'Taxi' });
    const deletion = tomb('x', T0, T0 + 9000);
    expect(get(mergeRecordSet([edit], [deletion]), 'x')?.deletedAt).toBe(T0 + 9000);
  });

  it('a genuinely NEWER edit beats an older tombstone (legit resurrection / re-add)', () => {
    const deletion = tomb('x', T0, T0 + 1000);
    const readd = rec('x', T0 + 5000, { name: 'Taxi (again)' }); // re-added later
    const out = get(mergeRecordSet([deletion], [readd]), 'x');
    expect(out).toEqual(readd);
    expect(out?.deletedAt).toBeUndefined();
    // commutative
    sameSet(mergeRecordSet([deletion], [readd]), mergeRecordSet([readd], [deletion]));
  });

  it('an OLDER edit can NEVER resurrect a newer tombstone (no accidental zombie)', () => {
    const staleEdit = rec('x', T0, { name: 'Taxi' });
    const deletion = tomb('x', T0 + 1000, T0 + 8000);
    expect(get(mergeRecordSet([deletion], [staleEdit]), 'x')?.deletedAt).toBe(T0 + 8000);
    expect(get(mergeRecordSet([staleEdit], [deletion]), 'x')?.deletedAt).toBe(T0 + 8000);
  });

  it('on an exact clock tie, a delete beats a live edit (safe convergence, both sides)', () => {
    const edit = rec('x', T0 + 3000, { name: 'Taxi' });
    // deletedAt chosen so clock(deletion) === clock(edit) === T0 + 3000
    const deletion = tomb('x', T0, T0 + 3000);
    expect(get(mergeRecordSet([edit], [deletion]), 'x')?.deletedAt).toBe(T0 + 3000);
    expect(get(mergeRecordSet([deletion], [edit]), 'x')?.deletedAt).toBe(T0 + 3000);
  });

  it('the newer of two competing tombstones wins (re-delete after a re-add)', () => {
    const firstDelete = tomb('x', T0, T0 + 1000);
    const secondDelete = tomb('x', T0 + 4000, T0 + 5000);
    expect(get(mergeRecordSet([firstDelete], [secondDelete]), 'x')?.deletedAt).toBe(T0 + 5000);
    expect(get(mergeRecordSet([secondDelete], [firstDelete]), 'x')?.deletedAt).toBe(T0 + 5000);
  });
});

// ---------------------------------------------------------------------------
// Concurrent disjoint edits — nothing is lost
// ---------------------------------------------------------------------------

describe('mergeRecordSet — concurrent disjoint changes both survive', () => {
  it('two devices each add a different expense offline; the merge keeps both', () => {
    const a = [rec('dinner', T0, { name: 'Dinner' })];
    const b = [rec('taxi', T0 + 100, { name: 'Taxi' })];
    const out = mergeRecordSet(a, b);
    expect(out).toHaveLength(2);
    expect(get(out, 'dinner')?.name).toBe('Dinner');
    expect(get(out, 'taxi')?.name).toBe('Taxi');
  });

  it('a per-record merge — one device edits record A, the other deletes record B; both intents land', () => {
    const base = [rec('A', T0, { name: 'A0' }), rec('B', T0, { name: 'B0' })];
    const deviceA = [rec('A', T0 + 1000, { name: 'A-edited' }), base[1]];
    const deviceB = [base[0], tomb('B', T0, T0 + 1000)];
    const out = mergeRecordSet(deviceA, deviceB);
    expect(get(out, 'A')?.name).toBe('A-edited'); // A's edit survived
    expect(get(out, 'B')?.deletedAt).toBe(T0 + 1000); // B's delete survived
  });
});

// ---------------------------------------------------------------------------
// Algebraic laws: commutativity, idempotency, fixed point
// ---------------------------------------------------------------------------

describe('mergeRecordSet — CRDT algebraic laws', () => {
  // A rich, mixed pair: shared ids with different clocks, tombstones on each
  // side, and disjoint ids — the kind of state two real devices reach.
  const a: Rec[] = [
    rec('shared-newer-on-a', T0 + 9000, { name: 'A wins' }),
    rec('shared-newer-on-b', T0, { name: 'A loses' }),
    tomb('deleted-on-a', T0, T0 + 7000),
    rec('only-on-a', T0 + 200, { name: 'solo A' }),
    rec('readd-on-a', T0 + 6000, { name: 'A re-added' }),
  ];
  const b: Rec[] = [
    rec('shared-newer-on-a', T0, { name: 'B loses' }),
    rec('shared-newer-on-b', T0 + 9000, { name: 'B wins' }),
    rec('deleted-on-a', T0, { name: 'still live on B' }),
    rec('only-on-b', T0 + 300, { name: 'solo B' }),
    tomb('readd-on-a', T0, T0 + 1000),
  ];

  it('is commutative: merge(a,b) deep-equals merge(b,a)', () => {
    sameSet(mergeRecordSet(a, b), mergeRecordSet(b, a));
  });

  it('is idempotent: merge(a,a) deep-equals a (re-publishing the same state does not drift)', () => {
    sameSet(mergeRecordSet(a, a), a);
  });

  it('produces the correct converged state on the mixed pair (no winner is wrong)', () => {
    const out = mergeRecordSet(a, b);
    expect(get(out, 'shared-newer-on-a')?.name).toBe('A wins');
    expect(get(out, 'shared-newer-on-b')?.name).toBe('B wins');
    expect(get(out, 'deleted-on-a')?.deletedAt).toBe(T0 + 7000); // delete (newer) beats live B
    expect(get(out, 'only-on-a')?.name).toBe('solo A');
    expect(get(out, 'only-on-b')?.name).toBe('solo B');
    expect(get(out, 'readd-on-a')?.name).toBe('A re-added'); // re-add (T0+6000) beats tomb (T0+1000)
    expect(get(out, 'readd-on-a')?.deletedAt).toBeUndefined();
    expect(out).toHaveLength(6);
  });

  it('re-merging the converged state against either parent is a fixed point', () => {
    const merged = mergeRecordSet(a, b);
    sameSet(mergeRecordSet(merged, a), merged);
    sameSet(mergeRecordSet(merged, b), merged);
    sameSet(mergeRecordSet(merged, merged), merged);
  });

  it('is order-insensitive across a three-device fan-in (associative in the way that matters)', () => {
    const c: Rec[] = [
      rec('shared-newer-on-a', T0 + 1, { name: 'C loses' }),
      rec('only-on-c', T0 + 400, { name: 'solo C' }),
      tomb('only-on-b', T0 + 300, T0 + 8000),
    ];
    sameSet(mergeRecordSet(mergeRecordSet(a, b), c), mergeRecordSet(a, mergeRecordSet(b, c)));
  });
});

// ---------------------------------------------------------------------------
// Degenerate inputs
// ---------------------------------------------------------------------------

describe('mergeRecordSet — empty and one-sided', () => {
  it('merging into empty returns the other side', () => {
    const xs = [rec('a', T0), rec('b', T0 + 1)];
    sameSet(mergeRecordSet([], xs), xs);
    sameSet(mergeRecordSet(xs, []), xs);
  });

  it('merging two empty sets is empty', () => {
    expect(mergeRecordSet([], [])).toEqual([]);
  });

  it('a lone tombstone survives a merge against empty (a delete is real state, not nothing)', () => {
    const t = [tomb('gone', T0, T0 + 1)];
    sameSet(mergeRecordSet([], t), t);
  });

  it('never mutates either input array', () => {
    const left = [rec('x', T0, { name: 'L' })];
    const right = [rec('x', T0 + 1, { name: 'R' }), rec('y', T0)];
    const leftCopy = JSON.stringify(left);
    const rightCopy = JSON.stringify(right);
    mergeRecordSet(left, right);
    expect(JSON.stringify(left)).toBe(leftCopy);
    expect(JSON.stringify(right)).toBe(rightCopy);
  });
});

// ---------------------------------------------------------------------------
// Tie-break determinism — two copies stamping the same millisecond must
// converge to ONE copy on every device, whatever shape the copies are in.
// These pin the winner()/stableStringify()/shallowEqual() semantics.
// ---------------------------------------------------------------------------

describe('mergeRecordSet — tie-break determinism', () => {
  /** Merge one-record sets both ways; every assertion must hold on each. */
  const winners = (a: Rec, b: Rec): Rec[] => [
    get(mergeRecordSet([a], [b]), a.id)!,
    get(mergeRecordSet([b], [a]), a.id)!,
  ];

  it('a live tie resolves to the greater serialized content, from both sides', () => {
    const smaller = rec('x', T0, { name: 'A' });
    const greater = rec('x', T0, { name: 'B' });
    for (const w of winners(smaller, greater)) expect(w.name).toBe('B');
  });

  it('object key INSERTION order never influences which copy wins a tie', () => {
    // The same logical record can reach the merge with different key orders
    // (built in memory vs hydrated from JSON / off the wire). The tie-break must
    // compare content, not key order: z:9 beats z:2 regardless of construction.
    const idFirst = { id: 'x', updatedAt: T0, z: 9 } as Rec & { z: number };
    const zFirst = { z: 2, id: 'x', updatedAt: T0 } as Rec & { z: number };
    for (const w of winners(idFirst, zFirst)) expect((w as unknown as { z: number }).z).toBe(9);
  });

  it('an explicitly-undefined key serializes like an absent key (what the JSON wire drops)', () => {
    const withUndef = { id: 'x', updatedAt: T0, aaa: undefined, z: 9 } as Rec & { z: number };
    const plain = { id: 'x', updatedAt: T0, z: 2 } as Rec & { z: number };
    for (const w of winners(withUndef, plain)) expect((w as unknown as { z: number }).z).toBe(9);
  });

  it('null-valued fields serialize safely and the tie still converges', () => {
    const a = rec('x', T0, { name: 'A', note: null } as unknown as Partial<Rec>);
    const b = rec('x', T0, { name: 'B', note: null } as unknown as Partial<Rec>);
    for (const w of winners(a, b)) expect(w.name).toBe('B');
  });

  it('array-valued fields compare by content and the tie converges to the same copy', () => {
    // Groups carry array fields on every record (an expense's payers/splits), so
    // the nested path is the common case here, not an exotic one.
    const a = { id: 'x', updatedAt: T0, tags: ['b'] } as Rec & { tags: string[] };
    const b = { id: 'x', updatedAt: T0, tags: ['a'] } as Rec & { tags: string[] };
    for (const w of winners(a, b)) expect((w as unknown as { tags: string[] }).tags).toEqual(['b']);
  });

  it("sparse array slots serialize as the wire's null, so both devices compare the same content", () => {
    // JSON.stringify([undefined, 2]) is '[null,2]' — a record that crossed the
    // wire and one still in memory must serialize identically, or the tie-break
    // would order them differently on the two devices.
    const inMemory = { id: 'x', updatedAt: T0, tags: [undefined, 2] } as Rec & { tags: unknown[] };
    const other = { id: 'x', updatedAt: T0, tags: [9] } as Rec & { tags: unknown[] };
    const ab = get(mergeRecordSet([inMemory], [other]), 'x');
    const ba = get(mergeRecordSet([other], [inMemory]), 'x');
    expect(ab).toEqual(ba);
    // '[null,2]' > '[9]' ('n' > '9') — the wire-form comparison decides.
    expect((ab as unknown as { tags: unknown[] }).tags).toEqual([undefined, 2]);
  });

  it('a tie against a copy MISSING a field still converges (both directions, either side lean)', () => {
    // shallow-equality must not mistake {id,updatedAt} for {id,updatedAt,name}
    // in either direction — a false "equal" would let each device keep its own
    // copy on a tie and diverge forever.
    const full = rec('x', T0, { name: 'M' });
    const lean = rec('x', T0);
    const [ab1, ba1] = winners(full, lean);
    expect(ab1).toEqual(ba1);
    const [ab2, ba2] = winners(lean, full);
    expect(ab2).toEqual(ba2);
  });

  it('a value-equal remote copy never replaces the local object (memo stability)', () => {
    // Value-equal but not reference-equal (nested array forces the deep path).
    // Returning the local object keeps React list memoization from re-rendering
    // every row on each inbound publish.
    const local = { id: 'x', updatedAt: T0, tags: ['a'] } as Rec & { tags: string[] };
    const remote = { id: 'x', updatedAt: T0, tags: ['a'] } as Rec & { tags: string[] };
    expect(get(mergeRecordSet([local], [remote]), 'x')).toBe(local);
    // Same contract between two value-equal tombstones.
    const localDead = { id: 'y', updatedAt: T0, deletedAt: T0 + 1, tags: ['a'] } as Rec & {
      tags: string[];
    };
    const remoteDead = { id: 'y', updatedAt: T0, deletedAt: T0 + 1, tags: ['a'] } as Rec & {
      tags: string[];
    };
    expect(get(mergeRecordSet([localDead], [remoteDead]), 'y')).toBe(localDead);
  });

  it('between two tied tombstones the LEANER payload wins (the size bound must propagate)', () => {
    // A payload-stripped tombstone must beat a fatter copy even when the fat
    // copy would win a plain content comparison.
    const fat = tomb('x', T0, T0 + 5, { name: 'Dinner!' });
    const leanDead = tomb('x', T0, T0 + 5, { name: 'Di' });
    for (const w of winners(fat, leanDead)) expect(w.name).toBe('Di');
  });

  it('live ties do NOT use the leaner rule — content decides even when longer', () => {
    const longLive = rec('x', T0, { name: 'Dinner!' });
    const shortLive = rec('x', T0, { name: 'Di' });
    for (const w of winners(longLive, shortLive)) expect(w.name).toBe('Dinner!');
  });

  it('two tied tombstones of EQUAL size converge to the greater content', () => {
    const aa = tomb('x', T0, T0 + 5, { name: 'AA' });
    const zz = tomb('x', T0, T0 + 5, { name: 'ZZ' });
    for (const w of winners(aa, zz)) expect(w.name).toBe('ZZ');
  });
});

// ---------------------------------------------------------------------------
// The optional `combine` hook. split-expenses does not use it today (mergeGroup
// calls mergeRecordSet without one), but it is part of the shared file's
// documented contract and nothing else in this repo reaches it — so a re-sync
// that broke it would otherwise land here silently.
// ---------------------------------------------------------------------------

describe('mergeRecordSet — the optional combine hook', () => {
  it('runs for every id present on BOTH sides, with (winner, loser) in that order', () => {
    const calls: Array<[string, string]> = [];
    const combine = (win: Rec, lose: Rec): Rec => {
      calls.push([win.name!, lose.name!]);
      return win;
    };
    mergeRecordSet(
      [rec('shared', T0 + 10, { name: 'winner' }), rec('only-a', T0, { name: 'A' })],
      [rec('shared', T0, { name: 'loser' }), rec('only-b', T0, { name: 'B' })],
      combine
    );
    expect(calls).toEqual([['winner', 'loser']]); // never for the disjoint ids
  });

  it('runs even when the winner is a tombstone, so a field clock can ride through a dead record', () => {
    const combine = jest.fn((win: Rec, _lose: Rec): Rec => win);
    mergeRecordSet(
      [tomb('x', T0, T0 + 9, { name: 'dead' })],
      [rec('x', T0, { name: 'live' })],
      combine
    );
    expect(combine).toHaveBeenCalledTimes(1);
    expect(combine.mock.calls[0][0].deletedAt).toBe(T0 + 9);
  });

  it("the hook's return value is what lands in the merged set", () => {
    const out = mergeRecordSet(
      [rec('x', T0 + 10, { name: 'winner', amount: 100 })],
      [rec('x', T0, { name: 'loser', amount: 250 })],
      (win, lose) => ({ ...win, amount: Math.max(win.amount!, lose.amount!) })
    );
    expect(get(out, 'x')).toEqual({ id: 'x', updatedAt: T0 + 10, name: 'winner', amount: 250 });
  });
});
