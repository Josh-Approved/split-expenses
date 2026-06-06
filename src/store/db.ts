/**
 * Local persistence — expo-sqlite. The whole Group is one CRDT document; we
 * store its scalar fields as columns and its three record sets (members,
 * expenses, settlements) as JSON blobs in the same row (the grocery-list
 * precedent). Writes are fire-and-forget from the store; reads happen once at
 * hydrate.
 *
 * Per-DEVICE state that must NEVER sync (which member this device is) lives in
 * its own `device_state` table, keyed by group id. Group-level deletes are
 * tombstoned in `group_tombstones` so a delete survives a cross-device merge.
 */

import * as SQLite from 'expo-sqlite';
import type { Group, Member, Expense, Settlement } from '../data/types';
import type { ShareIdentity } from '../sync/share';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = init();
  return dbPromise;
}

async function init(): Promise<SQLite.SQLiteDatabase> {
  const d = await SQLite.openDatabaseAsync('split-expenses.db');
  await d.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS groups (
      id            TEXT PRIMARY KEY NOT NULL,
      name          TEXT,
      baseCurrency  TEXT,
      members       TEXT,
      expenses      TEXT,
      settlements   TEXT,
      shareIdentity TEXT,
      createdAt     INTEGER,
      updatedAt     INTEGER
    );
    CREATE TABLE IF NOT EXISTS group_tombstones (
      id        TEXT PRIMARY KEY NOT NULL,
      deletedAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS device_state (
      groupId TEXT PRIMARY KEY NOT NULL,
      meId    TEXT
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      k TEXT PRIMARY KEY NOT NULL,
      v TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_meta (
      k TEXT PRIMARY KEY NOT NULL,
      v TEXT
    );
  `);
  return d;
}

interface GroupRow {
  id: string;
  name: string;
  baseCurrency: string;
  members: string;
  expenses: string;
  settlements: string;
  shareIdentity: string | null;
  createdAt: number;
  updatedAt: number;
}

function rowToGroup(r: GroupRow): Group {
  return {
    id: r.id,
    name: r.name,
    baseCurrency: r.baseCurrency,
    members: safeParse<Member[]>(r.members, []),
    expenses: safeParse<Expense[]>(r.expenses, []),
    settlements: safeParse<Settlement[]>(r.settlements, []),
    shareIdentity: r.shareIdentity ? safeParse<ShareIdentity | null>(r.shareIdentity, null) : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Load every group (active — tombstoned group ids are excluded). */
export async function loadAllGroups(): Promise<Group[]> {
  const d = await db();
  const rows = await d.getAllAsync<GroupRow>('SELECT * FROM groups');
  return rows.map(rowToGroup);
}

export async function saveGroup(g: Group): Promise<void> {
  const d = await db();
  await d.runAsync(
    `INSERT OR REPLACE INTO groups
       (id, name, baseCurrency, members, expenses, settlements, shareIdentity, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    g.id,
    g.name,
    g.baseCurrency,
    JSON.stringify(g.members),
    JSON.stringify(g.expenses),
    JSON.stringify(g.settlements),
    g.shareIdentity ? JSON.stringify(g.shareIdentity) : null,
    g.createdAt,
    g.updatedAt,
  );
}

export async function deleteGroupRow(id: string, deletedAt: number): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM groups WHERE id = ?', id);
  await d.runAsync(
    'INSERT OR REPLACE INTO group_tombstones (id, deletedAt) VALUES (?, ?)',
    id,
    deletedAt,
  );
}

export async function loadGroupTombstones(): Promise<Map<string, number>> {
  const d = await db();
  const rows = await d.getAllAsync<{ id: string; deletedAt: number }>(
    'SELECT * FROM group_tombstones',
  );
  return new Map(rows.map((r) => [r.id, r.deletedAt]));
}

/* ---- per-device "which member am I" --------------------------------- */

export async function loadDeviceState(): Promise<Map<string, string>> {
  const d = await db();
  const rows = await d.getAllAsync<{ groupId: string; meId: string | null }>(
    'SELECT * FROM device_state',
  );
  const m = new Map<string, string>();
  for (const r of rows) if (r.meId) m.set(r.groupId, r.meId);
  return m;
}

export async function setDeviceMe(groupId: string, meId: string | null): Promise<void> {
  const d = await db();
  await d.runAsync(
    'INSERT OR REPLACE INTO device_state (groupId, meId) VALUES (?, ?)',
    groupId,
    meId,
  );
}

/* ---- key/value settings -------------------------------------------- */

export async function getSetting(k: string): Promise<string | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ v: string }>(
    'SELECT v FROM app_settings WHERE k = ?',
    k,
  );
  return row?.v ?? null;
}

export async function setSetting(k: string, v: string): Promise<void> {
  const d = await db();
  await d.runAsync(
    'INSERT OR REPLACE INTO app_settings (k, v) VALUES (?, ?)',
    k,
    v,
  );
}
