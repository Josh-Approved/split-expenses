/**
 * Money helpers. All amounts in the data model are integer **minor units**
 * (cents) in some currency — never floats. These functions parse user input
 * into minor units, format minor units for display, and convert between
 * currencies in a way that PRESERVES the zero-sum invariant of a balance set
 * (the heart of "everyone sees the same numbers").
 */

import { decimalsFor } from './currencies';

/** Parse a user-typed amount string (e.g. "12.50", "1,234.5") into minor
 *  units for the given currency. Returns null if it isn't a valid number. */
export function parseAmount(input: string, code: string): number | null {
  if (input == null) return null;
  // Normalize: strip spaces and thousands separators, accept comma decimal.
  let s = String(input).trim().replace(/\s/g, '');
  if (s === '') return null;
  // If both separators present, the last one is the decimal separator.
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decSep = lastDot > lastComma ? '.' : ',';
    const thouSep = decSep === '.' ? ',' : '.';
    s = s.split(thouSep).join('');
    if (decSep === ',') s = s.replace(',', '.');
  } else if (lastComma >= 0) {
    // Only commas: treat as decimal if it looks like one (≤2 trailing digits
    // after the last comma and a single comma), else thousands.
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length <= 3) s = parts[0] + '.' + parts[1];
    else s = parts.join('');
  }
  if (!/^-?\d*\.?\d*$/.test(s) || s === '.' || s === '-') return null;
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  const scale = Math.pow(10, decimalsFor(code));
  return Math.round(value * scale);
}

/** Minor units → a plain numeric string ("12.50", "1200" for JPY), no symbol. */
export function formatMinorPlain(minor: number, code: string): string {
  const decimals = decimalsFor(code);
  const scale = Math.pow(10, decimals);
  const major = minor / scale;
  return major.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Minor units → a display string with the currency symbol ("$12.50"). */
export function formatMoney(minor: number, code: string): string {
  const info = symbolInfo(code);
  const sign = minor < 0 ? '-' : '';
  const body = formatMinorPlain(Math.abs(minor), code);
  // Symbols that read naturally as a prefix vs. a spaced code-style suffix.
  if (info.prefix) return `${sign}${info.symbol}${body}`;
  return `${sign}${body} ${info.symbol}`;
}

function symbolInfo(code: string): { symbol: string; prefix: boolean } {
  // Local import to avoid a cycle at module top; currencies.ts has no deps here.
  const { currency } = require('./currencies') as typeof import('./currencies');
  const c = currency(code);
  // Letter-style symbols (CHF, kr, Kč, zł, Rp, R$) read better as a suffix.
  const prefix = /^[^A-Za-z]/.test(c.symbol) || c.symbol === '$' || c.symbol === '£';
  return { symbol: c.symbol, prefix };
}

/**
 * Convert a set of signed minor-unit amounts from one currency to another at
 * `rate` (units of `toCode` per 1 unit of `fromCode`, in MAJOR units), and
 * return integer minor units in `toCode` whose sum equals the rounded total —
 * so a converted balance set still sums to zero.
 *
 * Largest-remainder rounding: round each independently, then nudge the entries
 * with the largest rounding error by ±1 until the residual is absorbed.
 * Deterministic given a stable input order.
 */
export function convertPreservingSum(
  amountsMinor: number[],
  rate: number,
  fromCode: string,
  toCode: string,
): number[] {
  const fromScale = Math.pow(10, decimalsFor(fromCode));
  const toScale = Math.pow(10, decimalsFor(toCode));
  // Exact float target in destination minor units for each entry.
  const targets = amountsMinor.map((m) => (m / fromScale) * rate * toScale);
  const rounded = targets.map((t) => Math.round(t));
  const targetTotal = Math.round(targets.reduce((a, b) => a + b, 0));
  let residual = targetTotal - rounded.reduce((a, b) => a + b, 0);
  if (residual === 0 || rounded.length === 0) return rounded;

  // Distribute the residual one unit at a time to the entries whose rounding
  // erred most in the needed direction.
  const step = residual > 0 ? 1 : -1;
  const errs = targets.map((t, i) => ({ i, err: t - rounded[i] }));
  errs.sort((a, b) =>
    step > 0 ? b.err - a.err : a.err - b.err,
  );
  let k = 0;
  while (residual !== 0) {
    rounded[errs[k % errs.length].i] += step;
    residual -= step;
    k++;
  }
  return rounded;
}

/** Convert a single signed minor-unit amount across currencies (rounded). */
export function convertOne(
  amountMinor: number,
  rate: number,
  fromCode: string,
  toCode: string,
): number {
  const fromScale = Math.pow(10, decimalsFor(fromCode));
  const toScale = Math.pow(10, decimalsFor(toCode));
  return Math.round((amountMinor / fromScale) * rate * toScale);
}
