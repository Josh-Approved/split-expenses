/**
 * A small, self-contained ISO 4217 currency table — code, symbol, name, and
 * the number of minor-unit decimals (most are 2; JPY/KRW are 0; some are 3).
 *
 * This is the display + scale source of truth; FX rates are separate (see
 * data/fx.ts). No network, no locale dependency at module load — the list is
 * static so formatting is deterministic on every device.
 */

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  /** Number of decimal places in the minor unit (cents). */
  decimals: number;
}

/** The currencies we surface in the picker, common-first. Extend freely. */
export const CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', symbol: '$', name: 'US Dollar', decimals: 2 },
  { code: 'EUR', symbol: '€', name: 'Euro', decimals: 2 },
  { code: 'GBP', symbol: '£', name: 'British Pound', decimals: 2 },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', decimals: 0 },
  { code: 'CAD', symbol: '$', name: 'Canadian Dollar', decimals: 2 },
  { code: 'AUD', symbol: '$', name: 'Australian Dollar', decimals: 2 },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc', decimals: 2 },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', decimals: 2 },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', decimals: 2 },
  { code: 'MXN', symbol: '$', name: 'Mexican Peso', decimals: 2 },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', decimals: 2 },
  { code: 'KRW', symbol: '₩', name: 'South Korean Won', decimals: 0 },
  { code: 'SGD', symbol: '$', name: 'Singapore Dollar', decimals: 2 },
  { code: 'HKD', symbol: '$', name: 'Hong Kong Dollar', decimals: 2 },
  { code: 'NZD', symbol: '$', name: 'New Zealand Dollar', decimals: 2 },
  { code: 'SEK', symbol: 'kr', name: 'Swedish Krona', decimals: 2 },
  { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone', decimals: 2 },
  { code: 'DKK', symbol: 'kr', name: 'Danish Krone', decimals: 2 },
  { code: 'PLN', symbol: 'zł', name: 'Polish Złoty', decimals: 2 },
  { code: 'CZK', symbol: 'Kč', name: 'Czech Koruna', decimals: 2 },
  { code: 'THB', symbol: '฿', name: 'Thai Baht', decimals: 2 },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', decimals: 2 },
  { code: 'TRY', symbol: '₺', name: 'Turkish Lira', decimals: 2 },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', decimals: 2 },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', decimals: 2 },
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso', decimals: 2 },
  { code: 'VND', symbol: '₫', name: 'Vietnamese Dong', decimals: 0 },
];

const BY_CODE: Map<string, CurrencyInfo> = new Map(
  CURRENCIES.map((c) => [c.code, c]),
);

/** Look up a currency; falls back to a 2-decimal entry using the code itself
 *  as symbol so an unknown/legacy code never crashes formatting. */
export function currency(code: string): CurrencyInfo {
  return (
    BY_CODE.get(code) ?? { code, symbol: code, name: code, decimals: 2 }
  );
}

/** Decimal places for a currency's minor unit. */
export function decimalsFor(code: string): number {
  return currency(code).decimals;
}
