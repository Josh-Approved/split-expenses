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
 * COLD-START BACKFILL. Relays are ephemeral couriers — they don't store, so a
 * device that just opened (or reconnected, or joined a link) hears nothing
 * until the OTHER side edits. Fixed with a "hello" handshake: on each
 * (re)connect a device announces itself AND re-publishes its own state; any
 * peer that hears a hello force-republishes its current state. Hello carries no
 * group data, so older app versions ignore it (wire-compatible).
 *
 * Skewed device clocks are handled by the logical clock (see ./clock.ts);
 * `mergeRemoteGroup` folds the peer's timestamps in before merging.
 *
 * NOT DEVICE-VERIFIED end-to-end (see transport.ts / crypto.ts headers).
 */

import { useGroups } from '../store/groups';
import type { Group } from '../data/types';
import { channelId, seal, open } from './crypto';
import { DropBoxTransport } from './transport';
import { markConnected, markDelivered, markReceived, markSent, dropStatus } from './status';

/** Control message asking peers to re-publish current state. A state message is
 *  a bare Group (has `shareIdentity`, no `_sync`), so the two never collide. */
const HELLO = JSON.stringify({ _sync: 'hello' });
const HELLO_DEBOUNCE_MS = 3000;

/** The slice of DropBoxTransport the engine drives. Named so a test can inject
 *  a fake (see __setTransportFactory) — the production transport is created and
 *  torn down entirely inside this module, so the wiring is otherwise unreachable. */
export interface EngineTransport {
  start(): void;
  publish(ciphertext: string): void;
  close(): void;
}

/** Factory for a transport; the signature matches the real `new DropBoxTransport(...)`
 *  call in `ensureChannel` exactly (channel, onReceive, onReconnect,
 *  onConnected(openRelays), onDelivered(delivered)). */
type TransportFactory = (
  channel: string,
  onReceive: (ciphertext: string) => void,
  onReconnect: () => void,
  onConnected: (openRelays: number) => void,
  onDelivered: (delivered: boolean) => void,
) => EngineTransport;

let makeTransport: TransportFactory = (
  channel,
  onReceive,
  onReconnect,
  onConnected,
  onDelivered,
) => new DropBoxTransport(channel, onReceive, onReconnect, onConnected, onDelivered);

/** TEST-ONLY seam: swap the transport factory (e.g. for a recording fake) and
 *  get back a restore fn. Production never calls this — the default factory
 *  builds the real DropBoxTransport with the same arguments. */
export function __setTransportFactory(factory: TransportFactory): () => void {
  const prev = makeTransport;
  makeTransport = factory;
  return () => {
    makeTransport = prev;
  };
}

interface Channel {
  transport: EngineTransport;
  lastSent: string;
  timer: ReturnType<typeof setTimeout> | null;
  lastHelloAt: number;
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
  const transport = makeTransport(
    channelId(secret),
    (ct) => receive(secret, ct),
    () => onReconnect(secret),
    (openRelays) => markConnected(secret, openRelays > 0),
    (delivered) => markDelivered(secret, delivered),
  );
  ch = { transport, lastSent: '', timer: null, lastHelloAt: 0 };
  channels.set(secret, ch);
  transport.start();
  return ch;
}

/** Handle one decrypted peer message: a hello (→ re-publish our state) or a
 *  group copy (→ merge it). */
function receive(secret: string, ct: string): void {
  const json = open(secret, ct);
  if (!json) return;
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return; // malformed — next publish re-converges
  }
  if (obj && typeof obj === 'object' && (obj as { _sync?: string })._sync === 'hello') {
    forcePublish(secret);
    return;
  }
  const remote = obj as Group;
  if (remote?.shareIdentity?.secret === secret) {
    // mergeRemoteGroup folds the remote clock in before merging (see clock.ts).
    useGroups.getState().mergeRemoteGroup(remote);
    markReceived(secret, Date.now());
  }
}

/** On (re)connect, PUSH our current state (so a peer already online converges
 *  to our latest) and PULL via hello (so peers push us theirs). Both are needed:
 *  hello alone only fetches, so a device reconnecting while its partner is
 *  already online would never re-share its own state. */
function onReconnect(secret: string): void {
  forcePublish(secret);
  sendHello(secret);
}

/** Announce ourselves so a peer re-publishes its current state. Debounced. */
function sendHello(secret: string): void {
  const ch = channels.get(secret);
  if (!ch) return;
  const t = Date.now();
  if (t - ch.lastHelloAt < HELLO_DEBOUNCE_MS) return;
  ch.lastHelloAt = t;
  ch.transport.publish(seal(secret, HELLO));
}

/** Publish our current full state immediately, bypassing the change-dedupe —
 *  used to answer a peer's hello (its copy may be empty/stale even though ours
 *  hasn't changed since we last sent). */
function forcePublish(secret: string): void {
  const ch = channels.get(secret);
  if (!ch) return;
  const group = useGroups.getState().groups.find((g) => sharedSecret(g) === secret);
  if (!group) return;
  const payload = serializeForWire(group);
  ch.lastSent = payload;
  ch.transport.publish(seal(secret, payload));
  markSent(secret, Date.now());
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
    markSent(secret, Date.now());
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
      dropStatus(secret);
    }
  }
}

/** Force an immediate full exchange for one shared group (the UI's manual
 *  "resync" affordance): push our state and ask peers for theirs. */
export function resyncNow(secret: string): void {
  onReconnect(secret);
}

/** Push current state immediately on every channel, skipping the debounce.
 *  Call when the app is about to background: the 700ms publish debounce would
 *  otherwise be suspended mid-wait, so an edit made right before switching apps
 *  never leaves the device. Best-effort — sockets may be closing. */
export function flushSyncEngine(): void {
  for (const secret of channels.keys()) {
    const ch = channels.get(secret);
    if (ch?.timer) {
      clearTimeout(ch.timer);
      ch.timer = null;
    }
    forcePublish(secret);
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
