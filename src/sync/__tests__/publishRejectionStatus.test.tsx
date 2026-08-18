/**
 * Sync-status honesty under publish rejection — the split-expenses port of
 * grocery-list defect grocery-list-20260704-8.
 *
 * The failure mode: the UI says "Connected" while every relay is rejecting our
 * publishes (NIP-20 OK-false: rate limit, max event size, …) — the socket is up
 * but nothing we publish leaves the device. The honest path threads a rejection
 * signal end to end:
 *
 *   transport.onWire(['OK', id, false, reason])  — every recipient rejected
 *     → onPublishResult(false, reason)           (transport.ts)
 *     → markDelivered(secret, false)             (engine wiring, sync/engine.ts)
 *     → status.publishRejected = true            (status.ts)
 *     → SyncStatusBar renders "Not syncing"      (not "Connected")
 *
 * split-expenses wires the identical `markDelivered` callback as its two
 * siblings but had no test for it; this suite pins both ends of the path
 * (mirrors grocery-list's and packing-list's publishRejectionStatus.test.tsx,
 * the fleet exemplars):
 *   • Transport level: the REAL DropBoxTransport over fake WebSockets — a
 *     rejection from every socket that received the event fires
 *     onPublishResult(false, reason); one acceptance anywhere fires (true).
 *   • Engine → status → UI: the REAL engine wiring (via __setTransportFactory,
 *     as engine.test.ts does) driving the REAL status store, with the REAL
 *     SyncStatusBar asserting the on-screen label reads "Not syncing" — and NOT
 *     "Connected" — while rejections are live, then recovers to "Connected" on
 *     the next accepted publish.
 *
 * Note on the engine seam: this app's TransportFactory declares the delivery
 * callback as `(delivered: boolean) => void` — the relay's rejection *reason*
 * is logged by the transport but not threaded into the engine, so the engine
 * half is driven with the one argument it actually receives.
 */

// Native side-effect stubs — the standard component-test preamble (see
// ScreenHeader.component.test.tsx): mock native side-effects, never the SUT.
jest.mock('expo-font', () => ({
  useFonts: () => [true, null],
  isLoaded: () => true,
  loadAsync: () => Promise.resolve(),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// SQLite can't load in node; persistence is fire-and-forget and not the SUT.
// Same surface engine.test.ts stubs.
jest.mock('../../store/db', () => ({
  loadAllGroups: jest.fn(async () => []),
  saveGroup: jest.fn(async () => {}),
  deleteGroupRow: jest.fn(async () => {}),
  loadGroupTombstones: jest.fn(async () => new Map()),
  loadDeviceState: jest.fn(async () => new Map()),
  setDeviceMe: jest.fn(async () => {}),
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
}));

// @noble/* is pure ESM (jest doesn't transform it — see engine.test.ts, which
// stubs the whole transport module for that reason). Here the transport's
// NIP-20 protocol handling IS the SUT, so instead we stub only its crypto
// primitives: a deterministic content hash (event ids stay unique + stable,
// which is all the NIP-20 ack bookkeeping needs) and an inert schnorr key/sig
// (fake relays don't verify signatures). Written in plain TS rather than
// node's `crypto`/`Buffer` because this app's tsconfig pins `types: ["jest"]`,
// so node globals are deliberately not in scope.
jest.mock('@noble/curves/secp256k1.js', () => ({
  schnorr: {
    getPublicKey: () => new Uint8Array(32).fill(7),
    sign: () => new Uint8Array(64).fill(9),
  },
}));
jest.mock('@noble/hashes/sha2.js', () => ({
  // FNV-1a expanded to 32 bytes: not cryptographic, but a pure function of the
  // input — the only property the transport relies on for an event id.
  sha256: (data: Uint8Array) => {
    const out = new Uint8Array(32);
    for (let lane = 0; lane < 4; lane++) {
      let h = 0x811c9dc5 ^ (lane * 0x9e3779b9);
      for (let i = 0; i < data.length; i++) {
        h ^= data[i];
        h = Math.imul(h, 0x01000193);
      }
      for (let b = 0; b < 8; b++) {
        out[lane * 8 + b] = h & 0xff;
        h = Math.imul(h ^ (h >>> 13), 0x85ebca6b);
      }
    }
    return out;
  },
}));
jest.mock('@noble/hashes/utils.js', () => ({
  bytesToHex: (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''),
  utf8ToBytes: (s: string) => {
    const out: number[] = [];
    for (let i = 0; i < s.length; i++) {
      const cp = s.codePointAt(i)!;
      if (cp > 0xffff) i++;
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      else if (cp < 0x10000)
        out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      else
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
    }
    return new Uint8Array(out);
  },
}));

import React from 'react';
import { render, screen, act, cleanup } from '@testing-library/react-native';

import { DropBoxTransport } from '../transport';
import { useSyncStatusStore } from '../status';
import { useGroups } from '../../store/groups';
import { newSecret } from '../crypto';
import {
  startSyncEngine,
  stopSyncEngine,
  __setTransportFactory,
  type EngineTransport,
} from '../engine';
import { SyncStatusBar } from '../../components/SyncStatusBar';
import type { Group } from '../../data/types';

// ---------------------------------------------------------------------------
// Fake WebSocket — lets the REAL transport run its wire protocol in node.
// ---------------------------------------------------------------------------

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }
  /** Test-side: the relay accepts the connection. */
  open() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
  /** Test-side: the relay sends us a frame. */
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  /** The Nostr event id of the EVENT frame this socket was sent, if any. */
  publishedEventId(): string | undefined {
    const ev = this.sent.map((s) => JSON.parse(s)).find((m) => m[0] === 'EVENT');
    return ev?.[1]?.id;
  }
}

const realWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

beforeAll(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
});
afterAll(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = realWebSocket;
});

beforeEach(() => {
  FakeWebSocket.instances = [];
});

// ---------------------------------------------------------------------------
// Layer 1 — DropBoxTransport surfaces NIP-20 rejections via onPublishResult
// ---------------------------------------------------------------------------

describe('DropBoxTransport publish-rejection (NIP-20 OK-false)', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  function openTransport(onPublishResult: jest.Mock) {
    const tr = new DropBoxTransport(
      'chan-honesty',
      jest.fn(),
      jest.fn(),
      jest.fn(),
      onPublishResult
    );
    tr.start();
    const sockets = FakeWebSocket.instances;
    expect(sockets.length).toBeGreaterThanOrEqual(2);
    sockets[0].open();
    sockets[1].open();
    return { tr, a: sockets[0], b: sockets[1] };
  }

  test('every recipient relay rejecting the publish fires onPublishResult(false, reason)', () => {
    const onPublishResult = jest.fn();
    const { tr, a, b } = openTransport(onPublishResult);

    tr.publish('ciphertext-payload-1');
    const id = a.publishedEventId();
    expect(id).toBeTruthy();
    expect(b.publishedEventId()).toBe(id); // both open relays got it

    // First rejection: not yet conclusive — the other recipient may accept.
    a.receive(['OK', id, false, 'rate-limited: slow down']);
    expect(onPublishResult).not.toHaveBeenCalled();

    // Second (= every recipient) rejection: the publish silently failed.
    b.receive(['OK', id, false, 'invalid: event too large']);
    expect(onPublishResult).toHaveBeenCalledTimes(1);
    expect(onPublishResult).toHaveBeenCalledWith(false, 'invalid: event too large');

    tr.close();
  });

  test('one acceptance anywhere means delivered — fires (true), later rejects ignored', () => {
    const onPublishResult = jest.fn();
    const { tr, a, b } = openTransport(onPublishResult);

    tr.publish('ciphertext-payload-2');
    const id = a.publishedEventId();

    a.receive(['OK', id, true, '']);
    expect(onPublishResult).toHaveBeenCalledTimes(1);
    expect(onPublishResult).toHaveBeenCalledWith(true, '');

    b.receive(['OK', id, false, 'rate-limited: slow down']);
    expect(onPublishResult).toHaveBeenCalledTimes(1); // still just the acceptance

    tr.close();
  });

  test('an OK for an event that is not ours is ignored entirely', () => {
    const onPublishResult = jest.fn();
    const { tr, a } = openTransport(onPublishResult);

    tr.publish('ciphertext-payload-3');
    a.receive(['OK', 'some-other-event-id', false, 'invalid: not yours']);
    expect(onPublishResult).not.toHaveBeenCalled();

    tr.close();
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — engine wiring → status store → SyncStatusBar label honesty
// ---------------------------------------------------------------------------

const SECRET = newSecret();
const AT = 1_700_000_000_000;

function sharedGroup(): Group {
  return {
    id: 'g-local',
    name: 'Lisbon',
    baseCurrency: 'USD',
    members: [],
    expenses: [],
    settlements: [],
    shareIdentity: { secret: SECRET, createdAt: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}

describe('sync status honesty: rejection reads "Not syncing", never "Connected"', () => {
  let onStatus: ((openRelays: number) => void) | undefined;
  let onDelivered: ((delivered: boolean) => void) | undefined;
  let restore: () => void;

  beforeEach(() => {
    restore = __setTransportFactory((_channel, _onReceive, _onReconnect, st, od) => {
      onStatus = st;
      onDelivered = od;
      const fake: EngineTransport = { start() {}, publish() {}, close() {} };
      return fake;
    });
    useGroups.setState({ groups: [sharedGroup()], me: {}, hydrated: true });
    startSyncEngine();
  });

  afterEach(() => {
    // Unmount any rendered SyncStatusBar BEFORE resetting the stores it
    // subscribes to — a bare setState against a mounted tree logs act() noise.
    cleanup();
    stopSyncEngine();
    restore();
    useGroups.setState({ groups: [], me: {}, hydrated: true });
    useSyncStatusStore.setState({ bySecret: {} });
    onStatus = undefined;
    onDelivered = undefined;
  });

  test('engine wiring: a rejected publish sets publishRejected while connected stays true', () => {
    onStatus!(2); // two relays open — the socket IS up
    expect(useSyncStatusStore.getState().bySecret[SECRET]?.connected).toBe(true);

    onDelivered!(false);

    const st = useSyncStatusStore.getState().bySecret[SECRET];
    // The exact shipped-defect shape: socket up, but our state is NOT leaving
    // the device. "Connected" here would be dishonest.
    expect(st.connected).toBe(true);
    expect(st.publishRejected).toBe(true);

    // The next accepted publish clears it.
    onDelivered!(true);
    expect(useSyncStatusStore.getState().bySecret[SECRET].publishRejected).toBe(false);
  });

  test('UI: SyncStatusBar shows "Not syncing" during rejection, recovers to "Connected"', async () => {
    onStatus!(2); // relays open before the bar mounts

    await render(<SyncStatusBar secret={SECRET} />);

    // Healthy connection: honest "Connected".
    expect(screen.getByText('Connected')).toBeTruthy();

    // Every relay rejects our publishes → the label must stop claiming
    // "Connected" (the reported defect) and read "Not syncing".
    await act(async () => onDelivered!(false));
    expect(screen.getByText('Not syncing')).toBeTruthy();
    expect(screen.queryByText('Connected')).toBeNull();

    // An accepted publish restores the honest "Connected".
    await act(async () => onDelivered!(true));
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByText('Not syncing')).toBeNull();
  });

  test('the accessible name carries the same honest status a sighted user reads', async () => {
    onStatus!(2);
    await render(<SyncStatusBar secret={SECRET} />);

    // Someone on VoiceOver must not be told "Connected" while publishes are
    // being refused — the label interpolates the SAME status word as the text.
    expect(
      screen.getByRole('button', { name: 'Shared group sync: Connected. Tap to sync now.' })
    ).toBeTruthy();

    await act(async () => onDelivered!(false));
    expect(
      screen.getByRole('button', { name: 'Shared group sync: Not syncing. Tap to sync now.' })
    ).toBeTruthy();
  });

  test('a fully dropped connection reads "Offline", not "Not syncing" (the third branch)', async () => {
    onStatus!(2);
    await render(<SyncStatusBar secret={SECRET} />);
    expect(screen.getByText('Connected')).toBeTruthy();

    // Every relay socket closed: offline outranks the rejection state, because
    // "Not syncing" would imply a live connection that is refusing us.
    await act(async () => onDelivered!(false));
    await act(async () => onStatus!(0));
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText('Not syncing')).toBeNull();
    expect(screen.queryByText('Connected')).toBeNull();
  });
});
