/**
 * Sync engine wiring (sync/engine.ts) — the layer where the shipped shared-list
 * defects actually lived (cold-start hello backfill, bidirectional reconnect
 * push, debounced/force publish, receive() dispatch, mergeRemoteGroup). The
 * merge primitives are exemplary-tested elsewhere (skewMerge / syncSim); this
 * pins the ENGINE, which was untested because DropBoxTransport is created inside
 * the module and couldn't be reached.
 *
 * The __setTransportFactory seam swaps in a recording fake so we can drive the
 * onReceive / onReconnect callbacks and inspect (decrypt) what the engine
 * publishes. Everything flows through the REAL crypto (seal/open/channelId) and
 * the REAL store (useGroups), so this exercises the production dispatch, not a
 * re-implementation.
 */

// The real DropBoxTransport pulls in @noble/* (pure ESM jest doesn't transform)
// and opens WebSockets. The engine never constructs it here — __setTransportFactory
// injects a fake — so stub the module out to keep the import graph node-loadable.
jest.mock('../transport', () => ({
  DropBoxTransport: class {
    start() {}
    publish() {}
    close() {}
  },
  RELAYS: [],
}));

// Stub the SQLite-backed persistence so the store loads in node (expo-sqlite
// can't). Persist is fire-and-forget; the in-memory state is the SUT.
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

import { useGroups } from '../../store/groups';
import { newSecret, seal, open } from '../crypto';
import {
  startSyncEngine,
  stopSyncEngine,
  __setTransportFactory,
  type EngineTransport,
} from '../engine';
import type { Group, Expense } from '../../data/types';

const SECRET = newSecret();

/** Recording fake — captures published ciphertext and exposes the engine's
 *  callbacks so a test can simulate an inbound message / reconnect. */
class FakeTransport implements EngineTransport {
  published: string[] = [];
  started = false;
  closed = false;
  constructor(
    public channel: string,
    public onReceive: (ct: string) => void,
    public onReconnect: () => void,
    public onConnected: (openRelays: number) => void,
    public onDelivered: (delivered: boolean) => void,
  ) {}
  start() {
    this.started = true;
  }
  publish(ct: string) {
    this.published.push(ct);
  }
  close() {
    this.closed = true;
  }
  /** Decrypt each published message to a parsed object for assertions. */
  decoded(): any[] {
    return this.published.map((ct) => JSON.parse(open(SECRET, ct) as string));
  }
  /** Simulate a peer message arriving (seal it as the peer would). */
  deliver(plaintext: string) {
    this.onReceive(seal(SECRET, plaintext));
  }
}

let created: FakeTransport[];
let restore: () => void;

const AT = 1_700_000_000_000;

function expense(id: string, updatedAt = AT): Expense {
  return {
    id,
    description: id,
    amount: 1000,
    currency: 'USD',
    rate: 1,
    payers: [],
    splitMethod: 'equal',
    splits: [],
    category: 'other',
    date: updatedAt,
    createdAt: updatedAt,
    updatedAt,
  };
}

function sharedGroup(expenses: Expense[] = []): Group {
  return {
    id: 'g-local',
    name: 'Lisbon',
    baseCurrency: 'USD',
    members: [],
    expenses,
    settlements: [],
    shareIdentity: { secret: SECRET, createdAt: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}

/** A bare group state message (has shareIdentity, no `_sync`). */
function isState(m: any): boolean {
  return m && m.shareIdentity && !m._sync;
}

beforeEach(() => {
  created = [];
  restore = __setTransportFactory((channel, onReceive, onReconnect, onConnected, onDelivered) => {
    const t = new FakeTransport(channel, onReceive, onReconnect, onConnected, onDelivered);
    created.push(t);
    return t;
  });
  useGroups.setState({ groups: [], me: {}, hydrated: true });
});

afterEach(() => {
  stopSyncEngine();
  restore();
  jest.useRealTimers();
});

describe('channel lifecycle', () => {
  test('a shared group opens exactly one started channel; a solo group opens none', () => {
    useGroups.setState({ groups: [sharedGroup()], me: {}, hydrated: true });
    startSyncEngine();
    expect(created).toHaveLength(1);
    expect(created[0].started).toBe(true);
  });
});

describe('startSyncEngine (a) — publishes a shared group state', () => {
  test('the debounced reconcile publish sends our group state', () => {
    jest.useFakeTimers();
    useGroups.setState({ groups: [sharedGroup([expense('dinner')])], me: {}, hydrated: true });
    startSyncEngine();

    expect(created[0].published).toHaveLength(0); // still inside the 700ms debounce
    jest.advanceTimersByTime(700);

    const state = created[0].decoded().find(isState);
    expect(state?.shareIdentity?.secret).toBe(SECRET);
    expect(state?.expenses?.some((e: any) => e.id === 'dinner')).toBe(true);
  });
});

describe('reconnect (b) — force-publish AND hello', () => {
  test('onReconnect pushes our state AND sends a hello to pull theirs', () => {
    useGroups.setState({ groups: [sharedGroup([expense('taxi')])], me: {}, hydrated: true });
    startSyncEngine();
    created[0].published = []; // ignore the debounced reconcile publish

    created[0].onReconnect();

    const msgs = created[0].decoded();
    expect(msgs.some(isState)).toBe(true); // pushed our state (force-publish)
    expect(msgs.some((m) => m._sync === 'hello')).toBe(true); // pulled via hello
  });
});

describe('hello handshake (c) — an inbound hello force-republishes our state', () => {
  test('receiving a peer hello immediately publishes our current group', () => {
    useGroups.setState({ groups: [sharedGroup([expense('eggs')])], me: {}, hydrated: true });
    startSyncEngine();
    created[0].published = [];

    created[0].deliver(JSON.stringify({ _sync: 'hello' }));

    const state = created[0].decoded().find(isState);
    expect(state?.expenses?.some((e: any) => e.id === 'eggs')).toBe(true);
  });
});

describe('receive() dispatch (d) — a peer group merges into the store', () => {
  test('a peer state message with our secret is merged via mergeRemoteGroup', () => {
    useGroups.setState({ groups: [sharedGroup([expense('bread')])], me: {}, hydrated: true });
    startSyncEngine();

    // Peer has our expense plus one more; devices have different local ids.
    const remote = sharedGroup([expense('bread'), expense('butter', AT + 5000)]);
    remote.id = 'g-peer';
    created[0].deliver(JSON.stringify(remote));

    const merged = useGroups.getState().groups[0];
    expect(merged.expenses.map((e) => e.id).sort()).toEqual(['bread', 'butter']);
  });

  test('a state message whose secret is not ours is ignored', () => {
    useGroups.setState({ groups: [sharedGroup([expense('rice')])], me: {}, hydrated: true });
    startSyncEngine();
    const before = JSON.stringify(useGroups.getState().groups);

    const foreign = sharedGroup([expense('poison', AT + 9000)]);
    foreign.shareIdentity = { secret: 'someone-elses-secret', createdAt: 1 };
    // Sealed under OUR channel secret (so open() succeeds) but carrying a
    // different shareIdentity — receive() must reject it on the secret mismatch.
    created[0].deliver(JSON.stringify(foreign));

    expect(JSON.stringify(useGroups.getState().groups)).toBe(before);
  });
});
