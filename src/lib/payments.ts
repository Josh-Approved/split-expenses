/**
 * Payment hand-off deep links. We NEVER move or confirm money — we just open
 * the right screen in the payee's own app with the recipient + amount (+ note)
 * prefilled, with an https web fallback when the app isn't installed. Balances
 * are arithmetic, not a wallet.
 *
 * The options offered at settle-up are exactly the handles the recipient chose
 * to share. If they shared none, only "mark as paid in cash" appears.
 */

import type { PaymentHandles } from '../data/types';
import { decimalsFor } from '../data/currencies';

export type PaymentApp = 'venmo' | 'paypal' | 'cashapp';

export interface PaymentOption {
  app: PaymentApp;
  label: string;
  /** Preferred deep link (opens the native app where supported). */
  url: string;
  /** https fallback used when the native app isn't installed. */
  fallbackUrl: string;
}

/** Amount as a plain major-unit decimal string for a payment-app URL ("12.34"). */
function amountParam(amountMinor: number, currency: string): string {
  const scale = Math.pow(10, decimalsFor(currency));
  return (amountMinor / scale).toFixed(decimalsFor(currency));
}

function clean(handle: string | undefined): string | null {
  if (!handle) return null;
  const h = handle.trim().replace(/^[@$]/, '');
  return h.length ? h : null;
}

/**
 * The hand-off options for paying `recipient` `amountMinor` (in `currency`),
 * built from the handles that recipient shared. `note` is prefilled where the
 * target app supports it.
 */
export function paymentOptions(
  handles: PaymentHandles | undefined,
  amountMinor: number,
  currency: string,
  note?: string,
): PaymentOption[] {
  if (!handles) return [];
  const amt = amountParam(amountMinor, currency);
  const noteEnc = encodeURIComponent(note ?? '');
  const options: PaymentOption[] = [];

  const venmo = clean(handles.venmo);
  if (venmo) {
    options.push({
      app: 'venmo',
      label: 'Pay with Venmo',
      url: `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(venmo)}&amount=${amt}&note=${noteEnc}`,
      fallbackUrl: `https://venmo.com/u/${encodeURIComponent(venmo)}`,
    });
  }

  const paypal = clean(handles.paypal);
  if (paypal) {
    // paypal.me is itself a universal link — the same URL is the app + web path.
    const url = `https://paypal.me/${encodeURIComponent(paypal)}/${amt}`;
    options.push({ app: 'paypal', label: 'Pay with PayPal', url, fallbackUrl: url });
  }

  const cashapp = clean(handles.cashapp);
  if (cashapp) {
    const url = `https://cash.app/$${encodeURIComponent(cashapp)}/${amt}`;
    options.push({ app: 'cashapp', label: 'Pay with Cash App', url, fallbackUrl: url });
  }

  return options;
}

/** True if the member shared at least one payment handle. */
export function hasAnyHandle(handles: PaymentHandles | undefined): boolean {
  return !!(clean(handles?.venmo) || clean(handles?.paypal) || clean(handles?.cashapp));
}
