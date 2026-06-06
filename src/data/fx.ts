/**
 * Multi-currency FX rates — at-entry-time conversion of an expense's currency
 * into a group's base currency.
 *
 * PRIVACY (studio tenet, non-negotiable): a rate lookup must leak NOTHING about
 * a transaction. We never tell a server the amount, the currency pair, or
 * anything that hints at what someone is splitting. So we fetch the WHOLE
 * USD-based rate table in one request and derive every cross-rate locally:
 *
 *     rate(from → to) = usdRates[to] / usdRates[from]
 *
 * One request, all currencies, no per-pair queries. The endpoint sees only
 * "someone asked for the public USD table" — the same thing every user asks.
 *
 * Endpoint: https://open.er-api.com/v6/latest/USD — open.er-api.com's free,
 * no-API-key, read-only public access tier. Returns:
 *   { result: "success", base_code: "USD",
 *     rates: { EUR: 0.92, ... }, time_last_update_unix: 1700000000 }
 *
 * Everything here is best-effort and crash-proof: getRate() ALWAYS resolves to
 * a usable number, falling back through manual override → live → cache → 1.0.
 * The error, if any, is surfaced out-of-band via `lastRateError` and the
 * `source` field of useRate(), never thrown at the UI.
 */

import { useEffect, useState } from 'react';
import { getSetting, setSetting } from '../store/db';

/* ---- constants ------------------------------------------------------- */

/** The one URL we ever hit. USD base; every other pair is derived locally. */
const FX_URL = 'https://open.er-api.com/v6/latest/USD';

/** Cache key for the whole USD table (JSON-encoded CachedTable). */
const CACHE_KEY = 'fx_table_usd';

/** Per-pair manual-override key, e.g. "fx_manual_EUR_USD". */
function manualKey(fromCode: string, toCode: string): string {
  return `fx_manual_${fromCode}_${toCode}`;
}

/** How long a fetched table is considered fresh. Daily reference rates don't
 *  move enough intraday to matter for splitting a dinner bill, and a 12h TTL
 *  keeps us off the network on the common path. */
const TTL_MS = 12 * 60 * 60 * 1000;

/* ---- shapes ---------------------------------------------------------- */

/** The shape we persist: the USD-based rate map plus when we fetched it. */
interface CachedTable {
  /** units of <code> per 1 USD, in MAJOR units. Always includes USD: 1. */
  rates: Record<string, number>;
  /** ms epoch when we stored this (our clock, for TTL). */
  fetchedAt: number;
}

/** Where a returned rate came from — surfaced by useRate() so the Add-Expense
 *  screen can show the user which rate it used and offer to override. */
export type RateSource = 'live' | 'cached' | 'manual' | 'fallback';

/* ---- in-memory state ------------------------------------------------- */

/**
 * The last-loaded table, kept in memory for the synchronous read path
 * (getRateSync) and to avoid touching SQLite on every getRate call. Null until
 * the first load (from cache or network) completes.
 */
let memTable: CachedTable | null = null;

/** Whether memTable came from a *fresh* network fetch this session, so we can
 *  label a rate 'live' vs 'cached'. Reset whenever we load from disk. */
let memIsLive = false;

/**
 * The most recent failure to refresh rates, or null if the last attempt
 * succeeded (or we've never needed the network). The UI can read this to show
 * a quiet "rates may be stale / offline" hint — getRate never throws it.
 */
export let lastRateError: Error | null = null;

/** De-dupe concurrent fetches: many expenses converting at once should share
 *  one in-flight request, not stampede the endpoint. */
let inFlight: Promise<CachedTable | null> | null = null;

/* ---- low-level table load -------------------------------------------- */

/** Read the persisted table from SQLite into a CachedTable (or null). */
async function readCache(): Promise<CachedTable | null> {
  const raw = await getSetting(CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedTable;
    if (parsed && parsed.rates && typeof parsed.fetchedAt === 'number') {
      return parsed;
    }
  } catch {
    // Corrupt/legacy blob — treat as no cache.
  }
  return null;
}

/** Persist a freshly fetched table. Fire-and-forget at the call sites. */
async function writeCache(table: CachedTable): Promise<void> {
  await setSetting(CACHE_KEY, JSON.stringify(table));
}

/** Is a cached table still within its TTL? */
function isFresh(table: CachedTable | null): boolean {
  return !!table && Date.now() - table.fetchedAt < TTL_MS;
}

/**
 * Fetch the whole USD table from the network. Resolves to a CachedTable on
 * success, or null on any failure (network, non-200, malformed body, API-level
 * `result !== "success"`). Records the failure in `lastRateError`. Never throws.
 */
async function fetchTable(): Promise<CachedTable | null> {
  try {
    const res = await fetch(FX_URL);
    if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
    const body = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
    };
    if (body.result !== 'success' || !body.rates || !body.rates.USD) {
      throw new Error('FX response missing rates');
    }
    const table: CachedTable = { rates: body.rates, fetchedAt: Date.now() };
    lastRateError = null;
    return table;
  } catch (err) {
    lastRateError = err instanceof Error ? err : new Error(String(err));
    return null;
  }
}

/**
 * Ensure we have a usable table loaded, refreshing if stale. Strategy:
 *   1. Use the in-memory table if it's still fresh.
 *   2. Otherwise read the disk cache; use it if fresh.
 *   3. Otherwise try the network; on success cache + return it.
 *   4. On network failure, fall back to whatever stale cache we have
 *      (better a day-old rate than none), else null.
 * Concurrent callers share one in-flight load.
 */
async function ensureTable(): Promise<CachedTable | null> {
  if (isFresh(memTable)) return memTable;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    // Prefer a fresh disk cache over hitting the network.
    const cached = await readCache();
    if (isFresh(cached)) {
      memTable = cached;
      memIsLive = false;
      return cached;
    }

    // Stale or absent — try the network.
    const fetched = await fetchTable();
    if (fetched) {
      memTable = fetched;
      memIsLive = true;
      void writeCache(fetched);
      return fetched;
    }

    // Network failed. Fall back to a stale cache if we have one, so the app
    // keeps converting with yesterday's rates instead of breaking.
    if (cached) {
      memTable = cached;
      memIsLive = false;
      return cached;
    }
    return null;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/* ---- cross-rate math ------------------------------------------------- */

/** Derive a cross-rate from the USD table, or null if either leg is missing.
 *  rate(from → to) = (to per USD) / (from per USD). */
function crossRate(
  table: CachedTable,
  fromCode: string,
  toCode: string,
): number | null {
  if (fromCode === toCode) return 1;
  const from = table.rates[fromCode];
  const to = table.rates[toCode];
  if (!from || !to || !Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }
  return to / from;
}

/* ---- manual overrides ------------------------------------------------ */

/**
 * Set a manual rate for a directed pair (units of toCode per 1 unit of
 * fromCode, MAJOR units). This is the user saying "ignore the market, use
 * THIS" — e.g. the rate their bank actually charged. Persisted per pair.
 * Pass null/undefined rate to clear it (we just store NaN → treated as unset).
 */
export async function setManualRate(
  fromCode: string,
  toCode: string,
  rate: number,
): Promise<void> {
  await setSetting(manualKey(fromCode, toCode), JSON.stringify(rate));
}

/** Read a manual override for a directed pair, or null if none set. */
export async function getManualRate(
  fromCode: string,
  toCode: string,
): Promise<number | null> {
  const raw = await getSetting(manualKey(fromCode, toCode));
  if (raw == null) return null;
  try {
    const n = JSON.parse(raw) as number;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/* ---- public API ------------------------------------------------------ */

/**
 * Units of `toCode` per 1 unit of `fromCode`, in MAJOR units — feed straight
 * into money.ts `convertOne` / `convertPreservingSum`. E.g. getRate('EUR',
 * 'USD') ≈ 1.08.
 *
 * Resolution order: manual override → live/cached table → 1.0 fallback. ALWAYS
 * resolves to a finite number; never throws. When it has to fall back to 1.0
 * for lack of data, `lastRateError` will be set so the UI can warn.
 */
export async function getRate(fromCode: string, toCode: string): Promise<number> {
  if (fromCode === toCode) return 1;

  // A manual override always wins — it's an explicit user decision.
  const manual = await getManualRate(fromCode, toCode);
  if (manual != null) return manual;

  const table = await ensureTable();
  if (table) {
    const r = crossRate(table, fromCode, toCode);
    if (r != null) return r;
  }

  // Truly no data for this pair (offline first run, or unknown code). Return a
  // safe identity so the UI renders a number; lastRateError flags the gap.
  if (!lastRateError) {
    lastRateError = new Error(`No FX rate for ${fromCode}→${toCode}`);
  }
  return 1;
}

/**
 * Synchronous rate read from the in-memory table, for render paths that can't
 * await (list rows, totals). Returns null if no table is loaded yet OR the pair
 * can't be derived — callers should treat null as "not ready / unknown" and
 * fall back to a stored expense.rate or kick off prefetchRates().
 *
 * Note: this does NOT consult manual overrides (those are async-persisted).
 * Use getRate() / useRate() where override-awareness matters.
 */
export function getRateSync(fromCode: string, toCode: string): number | null {
  if (fromCode === toCode) return 1;
  if (!memTable) return null;
  return crossRate(memTable, fromCode, toCode);
}

/**
 * Warm the cache at app start so getRateSync has data and the first expense
 * entry doesn't pay the network latency. Safe to call repeatedly; never throws.
 */
export async function prefetchRates(): Promise<void> {
  await ensureTable();
}

/* ---- React hook ------------------------------------------------------ */

/**
 * Live rate for a directed pair, for the Add-Expense screen — so it can show
 * which rate it used and let the user override. Returns the current `rate`, its
 * `source` ('live' fetched this session, 'cached' from disk, 'manual' user
 * override, or 'fallback' = 1.0 with no data), and a `loading` flag while the
 * first async resolution is in flight.
 *
 * Re-resolves when the pair changes. Reflects a manual override saved via
 * setManualRate only on the next mount/pair-change — pass a fresh key or remount
 * after writing one if you need it to update immediately.
 */
export function useRate(
  fromCode: string,
  toCode: string,
): { rate: number; source: RateSource; loading: boolean } {
  const [state, setState] = useState<{
    rate: number;
    source: RateSource;
    loading: boolean;
  }>(() => {
    // Seed synchronously from the in-memory table when we can, so a remount
    // with warm rates doesn't flash a loading state.
    const sync = getRateSync(fromCode, toCode);
    if (fromCode === toCode) return { rate: 1, source: 'cached', loading: false };
    if (sync != null) {
      return { rate: sync, source: memIsLive ? 'live' : 'cached', loading: false };
    }
    return { rate: 1, source: 'fallback', loading: true };
  });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));

    (async () => {
      // Resolve in the same priority order as getRate, but track the source.
      let rate: number;
      let source: RateSource;

      if (fromCode === toCode) {
        rate = 1;
        source = 'cached';
      } else {
        const manual = await getManualRate(fromCode, toCode);
        if (manual != null) {
          rate = manual;
          source = 'manual';
        } else {
          const table = await ensureTable();
          const r = table ? crossRate(table, fromCode, toCode) : null;
          if (r != null) {
            rate = r;
            source = memIsLive ? 'live' : 'cached';
          } else {
            rate = 1;
            source = 'fallback';
          }
        }
      }

      if (alive) setState({ rate, source, loading: false });
    })();

    return () => {
      alive = false;
    };
  }, [fromCode, toCode]);

  return state;
}
