/**
 * The split-expenses data model.
 *
 * A Group is the whole CRDT document: scalar fields merge last-write-wins on
 * `updatedAt`; the three record sets (members, expenses, settlements) merge
 * per-record via `mergeRecordSet` (LWW-element-set with tombstones). Nothing
 * derived — balances, the settle-up plan, currency-converted totals — is ever
 * stored or synced. Those are computed on each device from the converged
 * ledger, so the same state in always yields identical numbers out.
 *
 * Money is stored as integer **minor units** (cents) in the record's own
 * `currency`, never as a float — so the penny-remainder rule is exact and the
 * split math is deterministic. See data/money.ts.
 */

import type { ShareIdentity } from '../sync/share';

export type SplitMethod = 'equal' | 'exact' | 'shares' | 'percent';

/** One person who paid part of an expense, in the expense's own currency. */
export interface Payer {
  memberId: string;
  /** Minor units in the expense `currency`. Sum of all payers === amount. */
  amount: number;
}

/**
 * One participant's slice of the split. Meaning of `value` depends on the
 * expense's `splitMethod`:
 *  - equal:   ignored (presence means "included"); everyone splits evenly.
 *  - exact:   exact minor-unit amount this member owes.
 *  - shares:  this member's weight (integer-ish); owed is proportional.
 *  - percent: this member's percentage (0–100); owed is proportional.
 */
export interface SplitPart {
  memberId: string;
  value: number;
}

export interface Expense {
  id: string;
  description: string;
  /** Total, minor units, in `currency`. Always === sum of payer amounts. */
  amount: number;
  /** ISO 4217 code the amount/payers/splits are denominated in. */
  currency: string;
  /**
   * Units of the GROUP's base currency per 1 unit of this expense's currency,
   * captured at entry time (historical accuracy — later rate moves never
   * rewrite past balances). 1 when currency === group.baseCurrency.
   */
  rate: number;
  payers: Payer[];
  splitMethod: SplitMethod;
  /** Who the cost is split among, plus each one's per-method value. */
  splits: SplitPart[];
  /** Category key (see data/categories.ts). */
  category: string;
  /** The expense date (ms epoch) — distinct from createdAt. */
  date: number;
  note?: string;
  /**
   * Local file URI of an attached receipt photo. LOCAL-ONLY — never synced
   * (the expense record travels over the drop box; the image blob does not).
   */
  receiptUri?: string;
  createdAt: number;
  updatedAt: number;
  /** Tombstone (ms). Set instead of removing so a delete survives a merge. */
  deletedAt?: number;
}

export interface Settlement {
  id: string;
  /** Member who paid. */
  fromMember: string;
  /** Member who was paid. */
  toMember: string;
  /** Minor units in `currency`. */
  amount: number;
  currency: string;
  /** Units of base currency per 1 unit of `currency`, at entry time. */
  rate: number;
  method: 'cash' | 'external';
  date: number;
  note?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

/** Opt-in payment handles a member shares so others can pay them at settle-up. */
export interface PaymentHandles {
  /** Venmo username (no leading @). */
  venmo?: string;
  /** PayPal.me handle (the part after paypal.me/). */
  paypal?: string;
  /** Cash App $cashtag (no leading $). */
  cashapp?: string;
}

export interface Member {
  id: string;
  displayName: string;
  /** Avatar color (hex). */
  color?: string;
  /** Optional avatar emoji. */
  emoji?: string;
  /** Opt-in, group-only, E2E-encrypted like everything else. */
  handles?: PaymentHandles;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface Group {
  id: string;
  name: string;
  /** ISO 4217 display/base currency for derived balances. */
  baseCurrency: string;
  members: Member[];
  expenses: Expense[];
  settlements: Settlement[];
  /**
   * The shared-sync channel identity, written once at pairing and durable on
   * every paired device. Null for a purely-local group.
   */
  shareIdentity: ShareIdentity | null;
  createdAt: number;
  updatedAt: number;
  /** Tombstone for the group itself. */
  deletedAt?: number;
}

/**
 * Per-DEVICE local state, keyed by group id. NEVER part of the synced Group:
 *  - `meId`: which member this device represents ("me"), chosen at create/join.
 *  - reminder schedules live elsewhere (per-device too).
 */
export interface DeviceGroupState {
  groupId: string;
  meId?: string;
}
