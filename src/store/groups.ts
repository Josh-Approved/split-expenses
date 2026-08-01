/**
 * The app's whole mutation surface — a Zustand store over the SQLite layer.
 *
 * Every group is a CRDT document. Mutations bump the relevant record's
 * `updatedAt`; deletes set `deletedAt` (tombstones), never remove. Writes
 * persist fire-and-forget. The sync engine subscribes to this store to publish
 * shared groups and applies remote changes back through `mergeRemoteGroup`.
 *
 * `me` (which member each device is) is per-DEVICE: kept here in memory, mirrored
 * to `device_state`, and never part of a synced Group.
 */

import { create } from 'zustand';
import type {
  Group,
  Member,
  Expense,
  Settlement,
  PaymentHandles,
  SplitMethod,
  Payer,
  SplitPart,
} from '../data/types';
import { makeId } from '../lib/id';
import { nextColor } from '../data/avatars';
import { makeShareIdentity } from '../sync/share';
import { mergeGroup, resolveMemberId } from '../sync/mergeGroup';
import { now as clockNow, initClock, observe as observeClock, peek as clockPeek } from '../sync/clock';
import {
  loadAllGroups,
  saveGroup,
  deleteGroupRow,
  loadDeviceState,
  setDeviceMe,
  getSetting,
  setSetting,
} from './db';
import { QA_MODE } from '../qa/qaMode';
import { qaSeed } from '../qa/fixtures';

// Skew-resistant logical clock (see sync/clock.ts). Every merge-participating
// stamp flows through here, so comparing two devices' timestamps is safe even
// when their wall clocks differ.
const now = () => clockNow();

const CLOCK_KEY = 'syncClock';
const persistClock = (v: number) => {
  void setSetting(CLOCK_KEY, String(v));
};

/** Largest merge timestamp anywhere in a group (for lifting the clock on load). */
function groupMaxTs(g: Group): number {
  let m = Math.max(g.updatedAt, g.createdAt);
  for (const rec of [...g.members, ...g.expenses, ...g.settlements]) {
    m = Math.max(m, rec.updatedAt, rec.deletedAt ?? 0);
  }
  return m;
}

export interface NewExpense {
  description: string;
  amount: number;
  currency: string;
  rate: number;
  payers: Payer[];
  splitMethod: SplitMethod;
  splits: SplitPart[];
  category: string;
  date: number;
  note?: string;
  receiptUri?: string;
}

interface GroupsState {
  groups: Group[];
  /** groupId → memberId this device represents. */
  me: Record<string, string>;
  hydrated: boolean;

  hydrate: () => Promise<void>;

  getGroup: (id: string) => Group | undefined;
  createGroup: (opts: {
    name: string;
    baseCurrency: string;
    memberNames: string[];
    meIndex?: number;
  }) => string;
  renameGroup: (id: string, name: string) => void;
  setBaseCurrency: (id: string, code: string) => void;
  deleteGroup: (id: string) => void;
  duplicateGroup: (id: string) => string | null;

  addMember: (groupId: string, displayName: string) => string;
  updateMember: (groupId: string, memberId: string, patch: Partial<Member>) => void;
  setHandles: (groupId: string, memberId: string, handles: PaymentHandles) => void;
  removeMember: (groupId: string, memberId: string) => void;
  /** Fold one member (drop) into another (keep): reassign every expense and
   *  settlement, combining shared rows, then tombstone the duplicate. The fix
   *  when the same person ends up entered twice. */
  mergeMembers: (groupId: string, keepId: string, dropId: string) => void;

  setMe: (groupId: string, memberId: string) => void;
  getMe: (groupId: string) => string | undefined;

  addExpense: (groupId: string, e: NewExpense) => string;
  updateExpense: (groupId: string, expenseId: string, patch: Partial<Expense>) => void;
  deleteExpense: (groupId: string, expenseId: string) => void;

  addSettlement: (
    groupId: string,
    s: Omit<Settlement, 'id' | 'createdAt' | 'updatedAt'>,
  ) => string;
  deleteSettlement: (groupId: string, settlementId: string) => void;

  /** Mint (or return existing) share secret for a group. */
  shareGroup: (groupId: string) => string | null;
  /** Join a shared group by secret; creates a local placeholder that sync
   *  converges. Returns the local group id. Idempotent on the secret. */
  joinShared: (secret: string) => string;
  /** Sync entry: merge a converged remote copy of a shared group. */
  mergeRemoteGroup: (remote: Group) => void;

  /** Canon Layer 3 import — brings in groups with FRESH ids (a copy, never a
   *  silent overwrite). Returns the count imported. */
  importGroups: (incoming: Group[]) => number;

  /** Durably write all current groups + the clock high-water mark, AWAITED.
   *  Per-group saves are otherwise fire-and-forget, so an edit made right before
   *  the app is backgrounded can be lost if iOS suspends/kills it first. The
   *  App-level AppState handler awaits this on background. */
  flushPending: () => Promise<void>;
}

export const useGroups = create<GroupsState>((set, get) => {
  const persist = (g: Group) => {
    void saveGroup(g);
  };

  /** Apply a transform to one group, stamp updatedAt, persist. */
  const mutate = (id: string, fn: (g: Group) => Group) => {
    let updated: Group | undefined;
    set((s) => ({
      groups: s.groups.map((g) => {
        if (g.id !== id) return g;
        updated = { ...fn(g), updatedAt: now() };
        return updated;
      }),
    }));
    if (updated) persist(updated);
  };

  const upsertRecord = <K extends 'members' | 'expenses' | 'settlements'>(
    groupId: string,
    key: K,
    record: Group[K][number],
  ) => {
    mutate(groupId, (g) => {
      const list = g[key] as any[];
      const idx = list.findIndex((r) => r.id === (record as any).id);
      const next = idx >= 0
        ? list.map((r) => (r.id === (record as any).id ? record : r))
        : [...list, record];
      return { ...g, [key]: next } as Group;
    });
  };

  const tombstone = (groupId: string, key: 'members' | 'expenses' | 'settlements', recId: string) => {
    mutate(groupId, (g) => {
      const list = g[key] as any[];
      return {
        ...g,
        [key]: list.map((r) =>
          r.id === recId ? { ...r, deletedAt: now(), updatedAt: now() } : r,
        ),
      } as Group;
    });
  };

  return {
    groups: [],
    me: {},
    hydrated: false,

    hydrate: async () => {
      // QA_MODE (compile-time constant) seeds deterministic fixtures so the
      // capture pipeline boots a populated, screenshot-ready ledger. Tree-shaken
      // out of production builds.
      if (QA_MODE) {
        const seed = qaSeed();
        set({ groups: seed.groups, me: seed.me, hydrated: true });
        return;
      }
      const [groups, me, persistedClock] = await Promise.all([
        loadAllGroups(),
        loadDeviceState(),
        getSetting(CLOCK_KEY),
      ]);
      // Lift the clock above the persisted high-water mark AND anything on disk,
      // so a post-update / post-restore install never stamps below its own data.
      let maxTs = persistedClock ? Number(persistedClock) || 0 : 0;
      for (const g of groups) maxTs = Math.max(maxTs, groupMaxTs(g));
      initClock(maxTs, persistClock);
      set({ groups, me: Object.fromEntries(me), hydrated: true });
    },

    getGroup: (id) => get().groups.find((g) => g.id === id),

    createGroup: ({ name, baseCurrency, memberNames, meIndex }) => {
      const ts = now();
      const usedColors: string[] = [];
      const members: Member[] = memberNames
        .map((n) => n.trim())
        .filter(Boolean)
        .map((displayName) => {
          const color = nextColor(usedColors);
          usedColors.push(color);
          return { id: makeId('m'), displayName, color, createdAt: ts, updatedAt: ts };
        });
      const id = makeId('g');
      const group: Group = {
        id,
        name: name.trim() || 'Group',
        baseCurrency,
        members,
        expenses: [],
        settlements: [],
        shareIdentity: null,
        createdAt: ts,
        updatedAt: ts,
      };
      set((s) => ({ groups: [group, ...s.groups] }));
      persist(group);
      if (meIndex != null && members[meIndex]) {
        get().setMe(id, members[meIndex].id);
      }
      return id;
    },

    renameGroup: (id, name) => mutate(id, (g) => ({ ...g, name: name.trim() || g.name })),

    setBaseCurrency: (id, code) => mutate(id, (g) => ({ ...g, baseCurrency: code })),

    deleteGroup: (id) => {
      const ts = now();
      set((s) => ({ groups: s.groups.filter((g) => g.id !== id) }));
      void deleteGroupRow(id, ts);
    },

    duplicateGroup: (id) => {
      const src = get().getGroup(id);
      if (!src) return null;
      const ts = now();
      // Fresh ids throughout; a duplicate is a new, unshared group.
      const idMap = new Map<string, string>();
      const members = src.members
        .filter((m) => m.deletedAt == null)
        .map((m) => {
          const nid = makeId('m');
          idMap.set(m.id, nid);
          return { ...m, id: nid, createdAt: ts, updatedAt: ts, deletedAt: undefined };
        });
      const copy: Group = {
        id: makeId('g'),
        name: `${src.name} (copy)`,
        baseCurrency: src.baseCurrency,
        members,
        expenses: [], // a duplicate copies the people + currency, not the ledger
        settlements: [],
        shareIdentity: null,
        createdAt: ts,
        updatedAt: ts,
      };
      set((s) => ({ groups: [copy, ...s.groups] }));
      persist(copy);
      return copy.id;
    },

    addMember: (groupId, displayName) => {
      const g = get().getGroup(groupId);
      const used = (g?.members ?? []).map((m) => m.color).filter(Boolean) as string[];
      const ts = now();
      const member: Member = {
        id: makeId('m'),
        displayName: displayName.trim() || 'Member',
        color: nextColor(used),
        createdAt: ts,
        updatedAt: ts,
      };
      upsertRecord(groupId, 'members', member);
      return member.id;
    },

    updateMember: (groupId, memberId, patch) => {
      const g = get().getGroup(groupId);
      const cur = g?.members.find((m) => m.id === memberId);
      if (!cur) return;
      upsertRecord(groupId, 'members', { ...cur, ...patch, id: memberId, updatedAt: now() });
    },

    setHandles: (groupId, memberId, handles) => {
      const clean: PaymentHandles = {
        venmo: handles.venmo?.trim() || undefined,
        paypal: handles.paypal?.trim() || undefined,
        cashapp: handles.cashapp?.trim() || undefined,
      };
      get().updateMember(groupId, memberId, { handles: clean });
    },

    removeMember: (groupId, memberId) => tombstone(groupId, 'members', memberId),

    mergeMembers: (groupId, keepId, dropId) => {
      if (keepId === dropId) return;
      const ts = now();
      mutate(groupId, (g) => {
        const expenses = g.expenses.map((e) => {
          if (e.deletedAt != null) return e;
          const touched =
            e.payers.some((p) => p.memberId === dropId) ||
            e.splits.some((sp) => sp.memberId === dropId);
          if (!touched) return e;
          const payerMap = new Map<string, number>();
          for (const p of e.payers) {
            const id = p.memberId === dropId ? keepId : p.memberId;
            payerMap.set(id, (payerMap.get(id) ?? 0) + p.amount);
          }
          const splitMap = new Map<string, number>();
          for (const sp of e.splits) {
            const id = sp.memberId === dropId ? keepId : sp.memberId;
            splitMap.set(id, (splitMap.get(id) ?? 0) + sp.value);
          }
          return {
            ...e,
            payers: [...payerMap].map(([memberId, amount]) => ({ memberId, amount })),
            splits: [...splitMap].map(([memberId, value]) => ({ memberId, value })),
            updatedAt: ts,
          };
        });
        const settlements = g.settlements.map((st) => {
          if (st.deletedAt != null) return st;
          const from = st.fromMember === dropId ? keepId : st.fromMember;
          const to = st.toMember === dropId ? keepId : st.toMember;
          if (from === to) return { ...st, deletedAt: ts, updatedAt: ts }; // self-payment → void
          if (from === st.fromMember && to === st.toMember) return st;
          return { ...st, fromMember: from, toMember: to, updatedAt: ts };
        });
        // `mergedInto` makes the fold durable across sync, exactly as the
        // merge's own collapse does: a paired device that was offline through
        // this merge can still publish an expense naming `dropId`, and the
        // pointer is what lets the next merge re-point it at `keepId`.
        const members = g.members.map((m) =>
          m.id === dropId ? { ...m, mergedInto: keepId, deletedAt: ts, updatedAt: ts } : m,
        );
        return { ...g, expenses, settlements, members };
      });
      if (get().me[groupId] === dropId) get().setMe(groupId, keepId);
    },

    setMe: (groupId, memberId) => {
      set((s) => ({ me: { ...s.me, [groupId]: memberId } }));
      void setDeviceMe(groupId, memberId);
    },

    getMe: (groupId) => get().me[groupId],

    addExpense: (groupId, e) => {
      const ts = now();
      const expense: Expense = { id: makeId('e'), createdAt: ts, updatedAt: ts, ...e };
      upsertRecord(groupId, 'expenses', expense);
      return expense.id;
    },

    updateExpense: (groupId, expenseId, patch) => {
      const g = get().getGroup(groupId);
      const cur = g?.expenses.find((x) => x.id === expenseId);
      if (!cur) return;
      upsertRecord(groupId, 'expenses', { ...cur, ...patch, id: expenseId, updatedAt: now() });
    },

    deleteExpense: (groupId, expenseId) => tombstone(groupId, 'expenses', expenseId),

    addSettlement: (groupId, s) => {
      const ts = now();
      const settlement: Settlement = { id: makeId('s'), createdAt: ts, updatedAt: ts, ...s };
      upsertRecord(groupId, 'settlements', settlement);
      return settlement.id;
    },

    deleteSettlement: (groupId, settlementId) => tombstone(groupId, 'settlements', settlementId),

    shareGroup: (groupId) => {
      const g = get().getGroup(groupId);
      if (!g) return null;
      if (g.shareIdentity) return g.shareIdentity.secret;
      const identity = makeShareIdentity();
      mutate(groupId, (gg) => ({ ...gg, shareIdentity: identity }));
      return identity.secret;
    },

    joinShared: (secret) => {
      const existing = get().groups.find((g) => g.shareIdentity?.secret === secret);
      if (existing) return existing.id;
      const ts = now();
      const group: Group = {
        id: makeId('g'),
        name: 'Shared group',
        baseCurrency: 'USD',
        members: [],
        expenses: [],
        settlements: [],
        shareIdentity: { secret, createdAt: ts },
        createdAt: ts,
        updatedAt: ts,
      };
      set((s) => ({ groups: [group, ...s.groups] }));
      persist(group);
      return group.id;
    },

    mergeRemoteGroup: (remote) => {
      const local = get().groups.find(
        (g) => g.shareIdentity?.secret && g.shareIdentity.secret === remote.shareIdentity?.secret,
      );
      if (!local) return;
      // Advance our clock past every timestamp in the incoming copy so the next
      // local edit out-clocks the peer — "last action wins", not "fastest clock".
      observeClock(groupMaxTs(remote));
      const merged = mergeGroup(local, remote);
      set((s) => ({ groups: s.groups.map((g) => (g.id === local.id ? merged : g)) }));
      persist(merged);
      // If the merge's duplicate-name collapse folded away the member THIS
      // device is, follow the pointer — otherwise "me" silently points at
      // someone the roster no longer shows. Same fix-up the manual
      // `mergeMembers` flow does for a hand-merge.
      const meId = get().me[local.id];
      if (meId) {
        const resolved = resolveMemberId(merged.members, meId);
        if (resolved !== meId) get().setMe(local.id, resolved);
      }
    },

    importGroups: (incoming) => {
      const ts = now();
      const fresh = incoming.map((g) => ({
        ...g,
        id: makeId('g'),
        name: g.name,
        shareIdentity: null, // an imported copy is local until re-shared
        createdAt: ts,
        updatedAt: ts,
      }));
      set((s) => ({ groups: [...fresh, ...s.groups] }));
      fresh.forEach(persist);
      return fresh.length;
    },

    flushPending: async () => {
      const groups = get().groups;
      await Promise.all(groups.map((g) => saveGroup(g).catch(() => {})));
      try {
        await setSetting(CLOCK_KEY, String(clockPeek()));
      } catch {
        /* best-effort */
      }
    },
  };
});
