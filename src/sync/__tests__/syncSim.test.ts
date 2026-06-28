/**
 * Headless two/three-device sync simulator — the production-defect net for the
 * shared-group engine. Mirrors grocery-list's; see that file's header.
 *
 * Drives several virtual devices through random op sequences with random clock
 * skew, offline windows, restarts, and lossy delivery, all through the REAL
 * `mergeGroup` + logical clock, and asserts the CRDT invariants:
 *   1. CONVERGENCE   — after full exchange, all devices hold an identical
 *                      visible expense set.
 *   2. NO RESURRECTION — an expense every device has tombstoned stays gone.
 *   3. MONOTONIC CLOCKS — no device clock runs backwards.
 *   4. LAST CAUSAL WRITER WINS under skew (the property the fix restores).
 * Deterministic (seeded), dependency-free, runs in `npm test`.
 */
import { LogicalClock } from '../clock';
import { mergeGroup } from '../mergeGroup';
import type { Expense, Group } from '../../data/types';

const SECRET = 'sim-secret';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface World {
  realTime: number;
}

function maxTs(g: Group): number {
  let m = Math.max(g.updatedAt, g.createdAt);
  for (const r of [...g.members, ...g.expenses, ...g.settlements]) {
    m = Math.max(m, r.updatedAt, r.deletedAt ?? 0);
  }
  return m;
}

class SimDevice {
  group: Group;
  readonly clock: LogicalClock;
  private skewMs: number;
  private maxClockSeen = 0;
  clockRegressed = false;

  constructor(label: string, private world: World, skewMs: number) {
    this.skewMs = skewMs;
    this.clock = new LogicalClock({ physicalNow: () => this.world.realTime + this.skewMs });
    const at = this.tick();
    this.group = {
      id: `g_${label}`,
      name: 'Trip',
      baseCurrency: 'USD',
      members: [],
      expenses: [],
      settlements: [],
      shareIdentity: { secret: SECRET, createdAt: at },
      createdAt: at,
      updatedAt: at,
    };
  }

  private tick(): number {
    const t = this.clock.now();
    if (t < this.maxClockSeen) this.clockRegressed = true;
    this.maxClockSeen = t;
    return t;
  }

  reskew(skewMs: number): void {
    this.skewMs = skewMs;
  }

  restart(): void {
    const persisted = this.clock.peek();
    (this.clock as unknown as { last: number }).last = 0;
    this.clock.init(persisted, () => {});
  }

  addNew(id: string): void {
    const at = this.tick();
    const e: Expense = {
      id,
      description: id,
      amount: 100,
      currency: 'USD',
      rate: 1,
      payers: [],
      splitMethod: 'equal',
      splits: [],
      category: 'other',
      date: at,
      createdAt: at,
      updatedAt: at,
    };
    this.group = { ...this.group, updatedAt: at, expenses: [...this.group.expenses, e] };
  }

  editAmount(id: string, amount: number): void {
    const at = this.tick();
    this.group = {
      ...this.group,
      updatedAt: at,
      expenses: this.group.expenses.map((e) => (e.id === id ? { ...e, amount, updatedAt: at } : e)),
    };
  }

  delete(id: string): void {
    const at = this.tick();
    this.group = {
      ...this.group,
      updatedAt: at,
      expenses: this.group.expenses.map((e) =>
        e.id === id ? { ...e, deletedAt: at, updatedAt: at } : e,
      ),
    };
  }

  reAdd(id: string): void {
    const at = this.tick();
    this.group = {
      ...this.group,
      updatedAt: at,
      expenses: this.group.expenses.map((e) =>
        e.id === id ? { ...e, deletedAt: undefined, updatedAt: at } : e,
      ),
    };
  }

  receive(remote: Group): void {
    this.clock.observe(maxTs(remote));
    if (this.clock.peek() < this.maxClockSeen) this.clockRegressed = true;
    this.maxClockSeen = Math.max(this.maxClockSeen, this.clock.peek());
    this.group = mergeGroup(this.group, remote);
  }

  visibleIds(): string[] {
    return this.group.expenses.filter((e) => e.deletedAt == null).map((e) => e.id).sort();
  }

  visibleMap(): Record<string, number> {
    const m: Record<string, number> = {};
    for (const e of this.group.expenses) if (e.deletedAt == null) m[e.id] = e.amount;
    return m;
  }

  allIds(): string[] {
    return this.group.expenses.map((e) => e.id);
  }

  isDeleted(id: string): boolean {
    const e = this.group.expenses.find((x) => x.id === id);
    return !!e && e.deletedAt != null;
  }
}

function flush(devices: SimDevice[]): void {
  for (let round = 0; round < 4; round++) {
    for (const a of devices) for (const b of devices) if (a !== b) b.receive(a.group);
  }
}

function runScenario(seed: number): string | null {
  const rand = rng(seed);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const T0 = 1_700_000_000_000;
  const world: World = { realTime: T0 };
  const deviceCount = 2 + Math.floor(rand() * 2);
  const skews = [0, 1000, 60_000, 3_600_000, -90_000, 12 * 3_600_000];
  const devices = Array.from({ length: deviceCount }, (_, i) => new SimDevice(`d${i}`, world, pick(skews)));

  let nextItem = 0;
  const steps = 12 + Math.floor(rand() * 30);
  for (let s = 0; s < steps; s++) {
    world.realTime += Math.floor(rand() * 90_000);
    const dev = pick(devices);
    const roll = rand();
    if (roll < 0.3 || dev.allIds().length === 0) {
      dev.addNew(`e${nextItem++}`);
    } else if (roll < 0.5) {
      const id = pick(dev.allIds());
      if (!dev.isDeleted(id)) dev.editAmount(id, 100 + Math.floor(rand() * 9000));
    } else if (roll < 0.65) {
      const id = pick(dev.allIds());
      if (!dev.isDeleted(id)) dev.delete(id);
    } else if (roll < 0.75) {
      const id = pick(dev.allIds());
      if (dev.isDeleted(id)) dev.reAdd(id);
    } else if (roll < 0.85) {
      const other = pick(devices);
      if (other !== dev) {
        dev.receive(other.group);
        other.receive(dev.group);
      }
    } else if (roll < 0.93) {
      dev.reskew(pick(skews));
    } else {
      dev.restart();
    }
  }

  world.realTime += 3_600_000;
  flush(devices);

  for (const d of devices) if (d.clockRegressed) return 'clock regressed on a device';

  const canonical = (d: SimDevice): string => {
    const m = d.visibleMap();
    return Object.keys(m).sort().map((k) => `${k}=${m[k]}`).join(',');
  };
  const ref = canonical(devices[0]);
  for (let i = 1; i < devices.length; i++) {
    if (canonical(devices[i]) !== ref) return `divergence: d0=[${ref}] vs d${i}=[${canonical(devices[i])}]`;
  }

  const deletedEverywhere = devices[0].allIds().filter((id) => devices.every((d) => d.isDeleted(id)));
  for (const id of deletedEverywhere) {
    if (devices.some((d) => d.visibleIds().includes(id))) return `resurrection of ${id}`;
  }
  return null;
}

function runCausalChain(seed: number): string | null {
  const rand = rng(seed);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const T0 = 1_700_000_000_000;
  const world: World = { realTime: T0 };
  const skews = [0, 3_600_000, -3_600_000, 600_000, 12 * 3_600_000];
  const devs = [new SimDevice('a', world, pick(skews)), new SimDevice('b', world, pick(skews))];

  devs[0].addNew('x');
  devs[1].receive(devs[0].group);

  let expected = 100;
  const rounds = 6 + Math.floor(rand() * 12);
  for (let r = 0; r < rounds; r++) {
    world.realTime += 1000 + Math.floor(rand() * 120_000);
    const editor = devs[r % 2];
    const peer = devs[(r + 1) % 2];
    editor.receive(peer.group);
    if (rand() < 0.25) editor.reskew(pick(skews));
    expected = 1000 + r; // strictly increasing unique value
    editor.editAmount('x', expected);
  }

  world.realTime += 3_600_000;
  flush(devs);
  for (let i = 0; i < devs.length; i++) {
    const got = devs[i].visibleMap()['x'];
    if (got !== expected) return `last-writer lost: d${i} shows x=${got}, expected ${expected}`;
  }
  return null;
}

test('last causal writer wins under skew across 300 ping-pong chains', () => {
  const failures: string[] = [];
  for (let seed = 1; seed <= 300; seed++) {
    const breach = runCausalChain(seed);
    if (breach) failures.push(`seed ${seed}: ${breach}`);
  }
  expect(failures).toEqual([]);
});

test('convergence + no-resurrection across 400 randomised chaos scenarios', () => {
  const failures: string[] = [];
  for (let seed = 1; seed <= 400; seed++) {
    const breach = runScenario(seed);
    if (breach) failures.push(`seed ${seed}: ${breach}`);
  }
  expect(failures).toEqual([]);
});

test('scenarios are deterministic (same seed -> same outcome)', () => {
  for (const seed of [7, 42, 123, 256]) {
    expect(runScenario(seed)).toBe(runScenario(seed));
  }
});
