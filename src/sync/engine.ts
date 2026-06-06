/**
 * Sync engine — wires the store to the drop-box transport.
 *
 * For every group that has a share identity it keeps one transport open,
 * publishes the (encrypted) whole group when it changes locally, and merges
 * anything that arrives. The merge is conflict-free, so this can be
 * best-effort: a missed message re-converges on the next publish.
 *
 * Durable by construction: the channel is derived from the persistent
 * per-group secret, so a paired group reconnects forever with nothing from the
 * user ("pair once, synced forever"). Devices have different local group ids;
 * the shared secret — not the id — is the join key.
 *
 * Per-device / local-only fields never leave the device: `receiptUri` on an
 * expense is the local file path of an attached photo (the record travels over
 * the drop box, the image blob does not), and `me` (which member this device
 * is) is not part of the Group at all. We strip `receiptUri` before sealing.
 *
 * NOT DEVICE-VERIFIED end-to-end (see transport.ts / crypto.ts headers).
 */

import { useGroups } from '../store/groups';
import type { Group } from '../data/types';
import { channelId, seal, open } from './crypto';
import { DropBoxTransport } from './transport';

interface Channel {
  transport: DropBoxTransport;
  lastSent: string;
  timer: ReturnType<typeof setTimeout> | null;
}

const channels = new Map<string, Channel>();
let unsub: (() => void) | null = null;

function sharedSecret(g: Group): string | undefined {
  return g.shareIdentity?.secret;
}

/**
 * The exact bytes that go over the wire: the group with every local-only field
 * stripped. Keep this the single source of the serialized form so the
 * publish-dedupe compare (`lastSent`) and the actual publish never diverge.
 */
function serializeForWire(group: Group): string {
  const wire: Group = {
    ...group,
    expenses: group.expenses.map(({ receiptUri, ...rest }) => rest),
  };
  return JSON.stringify(wire);
}

function ensureChannel(secret: string): Channel {
  let ch = channels.get(secret);
  if (ch) return ch;
  const transport = new DropBoxTransport(channelId(secret), (ct) => {
    const json = open(secret, ct);
    if (!json) return;
    try {
      const remote = JSON.parse(json) as Group;
      if (remote?.shareIdentity?.secret === secret) {
        useGroups.getState().mergeRemoteGroup(remote);
      }
    } catch {
      /* malformed payload — ignore, next publish re-converges */
    }
  });
  ch = { transport, lastSent: '', timer: null };
  channels.set(secret, ch);
  transport.start();
  return ch;
}

function publish(secret: string, group: Group): void {
  const ch = ensureChannel(secret);
  const payload = serializeForWire(group);
  // Republish-loop guard: a remote merge re-enters reconcile, but the
  // serialized group is unchanged from what we last sent, so we skip it.
  if (payload === ch.lastSent) return;
  if (ch.timer) clearTimeout(ch.timer);
  ch.timer = setTimeout(() => {
    ch.lastSent = payload;
    ch.transport.publish(seal(secret, payload));
  }, 700);
}

function reconcile(groups: Group[]): void {
  const live = new Set<string>();
  for (const g of groups) {
    const secret = sharedSecret(g);
    if (!secret) continue;
    live.add(secret);
    publish(secret, g);
  }
  // Close channels for groups that are gone / no longer shared.
  for (const [secret, ch] of channels) {
    if (!live.has(secret)) {
      if (ch.timer) clearTimeout(ch.timer);
      ch.transport.close();
      channels.delete(secret);
    }
  }
}

/** Start once after the store has hydrated (App.tsx). Idempotent. */
export function startSyncEngine(): void {
  if (unsub) return;
  reconcile(useGroups.getState().groups);
  unsub = useGroups.subscribe((state) => reconcile(state.groups));
}

export function stopSyncEngine(): void {
  if (unsub) {
    unsub();
    unsub = null;
  }
  for (const ch of channels.values()) {
    if (ch.timer) clearTimeout(ch.timer);
    ch.transport.close();
  }
  channels.clear();
}
