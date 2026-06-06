/**
 * CSV export of one group's expenses — for the user's own accounting (a
 * spreadsheet, a reimbursement claim, taxes). Plain, portable, no account.
 *
 * Amounts are the expense's own currency, formatted as plain numbers (no
 * symbol) so a spreadsheet reads them as values. One row per active expense.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { Group, Expense } from '../data/types';
import { formatMinorPlain } from '../data/money';
import { category } from '../data/categories';
import { memberName } from './format';

const HEADER = [
  'Date',
  'Description',
  'Category',
  'Currency',
  'Amount',
  'Paid by',
  'Split among',
];

/** Quote a field for CSV: wrap in quotes and double any inner quotes when it
 *  contains a comma, quote, or newline (RFC 4180). */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',');
}

/** ISO date (YYYY-MM-DD) — unambiguous and spreadsheet-friendly. */
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function expenseRow(group: Group, e: Expense): string {
  const paidBy = e.payers.map((p) => memberName(group, p.memberId)).join('; ');
  const splitAmong = e.splits.map((sp) => memberName(group, sp.memberId)).join('; ');
  return csvRow([
    isoDate(e.date),
    e.description,
    category(e.category).label,
    e.currency,
    formatMinorPlain(e.amount, e.currency),
    paidBy,
    splitAmong,
  ]);
}

/** Build the CSV text for a group's active (non-deleted) expenses. */
export function groupToCsv(group: Group): string {
  const rows = group.expenses
    .filter((e) => e.deletedAt == null)
    .sort((a, b) => a.date - b.date || a.createdAt - b.createdAt)
    .map((e) => expenseRow(group, e));
  return [csvRow(HEADER), ...rows].join('\r\n') + '\r\n';
}

function safeName(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'group';
}

/** Write the group's CSV to a temp file and present the share sheet. */
export async function exportGroupCsv(group: Group): Promise<void> {
  const file = new File(Paths.cache, `${safeName(group.name)}-expenses.csv`);
  if (file.exists) file.delete();
  file.create();
  file.write(groupToCsv(group));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      dialogTitle: 'Export expenses',
      UTI: 'public.comma-separated-values-text',
    });
  }
}
