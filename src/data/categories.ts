/**
 * Expense categories — a small fixed set with a label and a Lucide icon name.
 * Plainspoken, travel/household-first. `other` is the default.
 */

export interface CategoryInfo {
  key: string;
  label: string;
  /** Lucide icon name (lucide-react-native). */
  icon: string;
}

export const CATEGORIES: CategoryInfo[] = [
  { key: 'general', label: 'General', icon: 'Receipt' },
  { key: 'food', label: 'Food & drink', icon: 'Utensils' },
  { key: 'groceries', label: 'Groceries', icon: 'ShoppingCart' },
  { key: 'lodging', label: 'Lodging', icon: 'BedDouble' },
  { key: 'transport', label: 'Transport', icon: 'Car' },
  { key: 'flights', label: 'Flights', icon: 'Plane' },
  { key: 'entertainment', label: 'Entertainment', icon: 'Ticket' },
  { key: 'shopping', label: 'Shopping', icon: 'ShoppingBag' },
  { key: 'utilities', label: 'Utilities', icon: 'Plug' },
  { key: 'rent', label: 'Rent', icon: 'Home' },
  { key: 'health', label: 'Health', icon: 'HeartPulse' },
  { key: 'other', label: 'Other', icon: 'Tag' },
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

export const DEFAULT_CATEGORY = 'general';

export function category(key: string): CategoryInfo {
  return BY_KEY.get(key) ?? BY_KEY.get('other')!;
}
