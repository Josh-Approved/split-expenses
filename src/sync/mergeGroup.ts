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
 */

import type { Group } from '../data/types';
import { mergeRecordSet } from './mergeRecordSet';

export function mergeGroup(local: Group, remote: Group): Group {
  const localNewer = local.updatedAt >= remote.updatedAt;
  const head = localNewer ? local : remote;
  return {
    id: local.id, // device-local id is authoritative; both refer to the same channel
    name: head.name,
    baseCurrency: head.baseCurrency,
    // A share identity, once present anywhere, is durable.
    shareIdentity: head.shareIdentity ?? local.shareIdentity ?? remote.shareIdentity ?? null,
    members: mergeRecordSet(local.members, remote.members),
    expenses: mergeRecordSet(local.expenses, remote.expenses),
    settlements: mergeRecordSet(local.settlements, remote.settlements),
    createdAt: Math.min(local.createdAt, remote.createdAt),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}
