/**
 * Plain-language formatting — money phrasing, member lookup, dates. Voice is
 * calm and second-person on the user's own position ("you're owed $42"),
 * third-person for everyone else. No jargon.
 */

import type { Group, Member } from '../data/types';
import { formatMoney } from '../data/money';

export function memberById(group: Group, id: string | undefined): Member | undefined {
  if (!id) return undefined;
  return group.members.find((m) => m.id === id);
}

export function memberName(group: Group, id: string | undefined, fallback = 'Someone'): string {
  return memberById(group, id)?.displayName ?? fallback;
}

export function activeMembers(group: Group): Member[] {
  return group.members.filter((m) => m.deletedAt == null);
}

/** "you're owed $42" / "you owe $18" / "all settled up" for the device's own
 *  net. `net` is base-currency minor units (positive = owed to you). */
export function phraseSelfNet(net: number, baseCurrency: string): string {
  if (net === 0) return 'all settled up';
  const amount = formatMoney(Math.abs(net), baseCurrency);
  return net > 0 ? `you're owed ${amount}` : `you owe ${amount}`;
}

/** Short version for a group card when "me" isn't set: total activity is muted. */
export function phraseGroupSubtitle(memberCount: number, expenseCount: number): string {
  const people = `${memberCount} ${memberCount === 1 ? 'person' : 'people'}`;
  if (expenseCount === 0) return `${people} · no expenses yet`;
  return `${people} · ${expenseCount} ${expenseCount === 1 ? 'expense' : 'expenses'}`;
}

const DAY = 24 * 60 * 60 * 1000;

/** Friendly relative-ish date: "Today", "Yesterday", else "Jun 3" / "Jun 3, 2025". */
export function formatDate(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfThat = new Date(ms);
  startOfThat.setHours(0, 0, 0, 0);
  const diffDays = Math.round((startOfToday.getTime() - startOfThat.getTime()) / DAY);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Initials for an avatar with no emoji ("Sam" → "S", "Mary Jane" → "MJ"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
