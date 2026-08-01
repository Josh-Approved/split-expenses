/**
 * The data-specific merge for a shared group, the same pattern grocery-list's
 * `mergeList` uses: scalar fields (name, baseCurrency) resolve last-write-wins
 * on the group's `updatedAt`; the three record sets merge per-record via the
 * factory `mergeRecordSet` (LWW-element-set with tombstones).
 *
 * No derived value (balance, settlement plan, converted total) is ever a field
 * here, so there is nothing divergent to merge — same converged state in,
 * identical balances out on every device.
 *
 * `meId` (which member this device is) is per-DEVICE and not part of the Group,
 * so it is never touched by a merge — the sync engine preserves it locally.
 * (It IS re-pointed through a collapse; the store does that with
 * `resolveMemberId` after applying a merge.)
 *
 * DUPLICATE MEMBERS COLLAPSE DETERMINISTICALLY — the split-expenses cousin of
 * grocery-list's + packing-list's duplicate-name collapse. Two people adding
 * "Sam" to the same group while offline mint two different member ids, and an
 * id-keyed union would leave two permanent Sams, silently splitting that
 * person's expenses across both and making every balance wrong. After the
 * record merge, live members sharing a normalized display name collapse to one,
 * and every reference to a folded-away member is re-pointed at the survivor.
 * The collapse is a pure function of the merged state, so every device computes
 * the same result — convergence is preserved. (Details on the collapse below.)
 */

import type { Expense, Group, Member, Settlement } from '../data/types';
import { mergeRecordSet } from './mergeRecordSet';

/**
 * THE member-identity rule — one normalizer for every layer that answers "are
 * these the same person?". Today that is the merge's collapse and the test
 * oracles; any future add-time dedupe must use this same function, because two
 * layers with different equality rules disagree about duplicates, which reads
 * as people flickering in and out of the roster.
 */
export function normalizeMemberName(name: string): string {
  return name.trim().toLowerCase();
}

/** Cap on how far a forwarding chain is followed (a → b → c). Chains are
 *  shallow by construction — a folded member is tombstoned and can never
 *  become a keeper again, so the pointers form a forest — but the cap keeps a
 *  corrupted payload from spinning, and truncating at a fixed depth is still a
 *  pure function of the input, so devices stay in agreement even then. */
const MAX_FORWARD_HOPS = 16;

/** Follow `direct` forwarding pointers to the end of the chain. */
function follow(direct: Map<string, string>, id: string): string {
  let cur = id;
  for (let i = 0; i < MAX_FORWARD_HOPS; i++) {
    const next = direct.get(cur);
    if (next == null || next === cur) break;
    cur = next;
  }
  return cur;
}

/**
 * Resolve a member id through any collapse that folded it away, returning the
 * surviving member's id (or the id unchanged when nothing folded it). Exported
 * for the per-device `meId`, which is not part of the merged document and so
 * has to be re-pointed by its owner after a merge.
 */
export function resolveMemberId(members: Member[], id: string): string {
  const direct = new Map<string, string>();
  const byId = new Map(members.map((m) => [m.id, m]));
  for (const m of members) {
    if (m.mergedInto && m.mergedInto !== m.id && byId.has(m.mergedInto)) {
      direct.set(m.id, m.mergedInto);
    }
  }
  return follow(direct, id);
}

/**
 * Reconcile members that share a normalized display name, and re-point every
 * reference to the ones that fold away.
 *
 * WHO SURVIVES. Only LIVE members are collapse candidates — a tombstoned member
 * is never resurrected and never wins keepership. Among a live duplicate set the
 * FRESHEST copy survives (newest `updatedAt`, ties by `createdAt` then id) and
 * keeps its own profile (color, emoji, payment handles): the newest add/edit is
 * the current intent, and keeping the oldest instead can resurrect someone the
 * group already removed. Losers are tombstoned at their own clock, so the
 * record-level tie-break (a delete is the safe branch) retires them everywhere.
 *
 * THE FORWARDING POINTER. Each loser also records `mergedInto: <survivor>`.
 * This is the part the list apps don't need: their items are referenced by
 * nothing, ours are referenced by every expense and settlement. The pointer has
 * to OUTLIVE the collapse that created it, because the remap and the record
 * merge do not move in lockstep — a rewritten expense carries the same
 * `updatedAt` as the copy it replaced (bumping it would forge an edit nobody
 * made), so a stale un-rewritten copy replayed out of the drop box can win the
 * content tie-break, and a device that was offline through the collapse can
 * publish a genuinely newer edit that still names the folded id. In both cases
 * the pointer survives in the member set and this pass simply re-points the
 * reference again. Without it, one replayed message would strand an expense on
 * a member nobody can see — on every device at once, since they all break the
 * tie identically.
 *
 * WHAT GETS RE-POINTED. Every live expense's payers and splits, and every live
 * settlement's from/to. Tombstoned records are left alone: they are inert (the
 * balance math filters them out) and rewriting them would churn the payload for
 * nothing. When both sides of a collapse appear inside one expense, the two
 * entries fold into ONE — amounts and split values summed, mirroring the
 * hand-merge in the store's `mergeMembers` — because the split math keys by
 * member id and would otherwise silently drop one of the pair's shares. A
 * settlement that ends up paying its own payer is voided (tombstoned at its own
 * clock) rather than left as a nonsense self-payment.
 *
 * Every branch above is a pure function of the merged state — no wall clock, no
 * local ids, no argument order — so all devices land on the same result.
 */
function collapseDuplicateMembers(
  members: Member[],
  expenses: Expense[],
  settlements: Settlement[],
): { members: Member[]; expenses: Expense[]; settlements: Settlement[] } {
  const byId = new Map(members.map((m) => [m.id, m]));

  // Forwarding pointers left by earlier collapses (possibly on another device,
  // possibly many syncs ago). A pointer to a member who is no longer in the set
  // is ignored rather than followed into nothing.
  const direct = new Map<string, string>();
  for (const m of members) {
    if (m.mergedInto && m.mergedInto !== m.id && byId.has(m.mergedInto)) {
      direct.set(m.id, m.mergedInto);
    }
  }

  // Live duplicates by normalized name. A blank name carries no identity (a
  // payload-stripped tombstone, or a record from a broken writer), so it never
  // groups with anything.
  const groups = new Map<string, Member[]>();
  for (const m of members) {
    if (m.deletedAt != null || m.displayName.trim() === '') continue;
    const key = normalizeMemberName(m.displayName);
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }

  const foldedMembers = new Map<string, Member>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        b.createdAt - a.createdAt ||
        (a.id < b.id ? -1 : 1),
    );
    const keeper = sorted[0];
    for (const dup of sorted.slice(1)) {
      direct.set(dup.id, keeper.id);
      foldedMembers.set(dup.id, {
        ...dup,
        mergedInto: keeper.id,
        deletedAt: Math.max(dup.updatedAt, dup.deletedAt ?? 0),
      });
    }
  }

  // Nothing has ever folded in this group — the overwhelmingly common case, and
  // one pass with no per-record allocation.
  if (direct.size === 0) return { members, expenses, settlements };

  // Flatten the chains once, so the per-reference lookup below is a single get.
  const alias = new Map<string, string>();
  for (const from of direct.keys()) {
    const to = follow(direct, from);
    if (to !== from) alias.set(from, to);
  }
  const survivor = (id: string) => alias.get(id) ?? id;

  const nextMembers = foldedMembers.size
    ? members.map((m) => foldedMembers.get(m.id) ?? m)
    : members;

  const nextExpenses = expenses.map((e) => {
    if (e.deletedAt != null) return e;
    const touched =
      e.payers.some((p) => alias.has(p.memberId)) ||
      e.splits.some((s) => alias.has(s.memberId));
    if (!touched) return e;
    // Map-keyed so a folded pair collapses to one entry; first-seen order is
    // preserved, and both devices start from the identical expense record.
    const payers = new Map<string, number>();
    for (const p of e.payers) {
      const id = survivor(p.memberId);
      payers.set(id, (payers.get(id) ?? 0) + p.amount);
    }
    const splits = new Map<string, number>();
    for (const s of e.splits) {
      const id = survivor(s.memberId);
      splits.set(id, (splits.get(id) ?? 0) + s.value);
    }
    return {
      ...e,
      payers: [...payers].map(([memberId, amount]) => ({ memberId, amount })),
      splits: [...splits].map(([memberId, value]) => ({ memberId, value })),
    };
  });

  const nextSettlements = settlements.map((st) => {
    if (st.deletedAt != null) return st;
    const from = survivor(st.fromMember);
    const to = survivor(st.toMember);
    if (from === st.fromMember && to === st.toMember) return st;
    // Both ends turned out to be the same person: the payment never happened.
    if (from === to) return { ...st, deletedAt: Math.max(st.updatedAt, st.deletedAt ?? 0) };
    return { ...st, fromMember: from, toMember: to };
  });

  return { members: nextMembers, expenses: nextExpenses, settlements: nextSettlements };
}

/**
 * Deterministic tie-break key for the scalar head fields (name, baseCurrency).
 * A device-independent function of the two candidates, so on an `updatedAt` tie
 * both devices pick the SAME winner and converge — never `localNewer`, which
 * would keep each device's own copy and diverge permanently (packing-list's
 * `mergeTrip` uses the same stable-serialized tie-break).
 */
function headKey(g: Group): string {
  return JSON.stringify([g.name, g.baseCurrency]);
}

export function mergeGroup(local: Group, remote: Group): Group {
  // Last-write-wins on `updatedAt`; on an exact tie fall back to a deterministic,
  // device-independent comparison of the tie-relevant scalar fields so both
  // sides converge instead of each keeping its own local values.
  const head =
    local.updatedAt !== remote.updatedAt
      ? local.updatedAt > remote.updatedAt
        ? local
        : remote
      : headKey(local) >= headKey(remote)
        ? local
        : remote;
  const collapsed = collapseDuplicateMembers(
    mergeRecordSet(local.members, remote.members),
    mergeRecordSet(local.expenses, remote.expenses),
    mergeRecordSet(local.settlements, remote.settlements),
  );
  return {
    id: local.id, // device-local id is authoritative; both refer to the same channel
    name: head.name,
    baseCurrency: head.baseCurrency,
    // A share identity, once present anywhere, is durable.
    shareIdentity: head.shareIdentity ?? local.shareIdentity ?? remote.shareIdentity ?? null,
    members: collapsed.members,
    expenses: collapsed.expenses,
    settlements: collapsed.settlements,
    createdAt: Math.min(local.createdAt, remote.createdAt),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}
