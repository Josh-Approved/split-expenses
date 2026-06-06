/**
 * Member avatar colors — a calm, distinct palette (aged-pigment, not neon).
 * Assigned round-robin as members are added; fully editable per member.
 */

export const MEMBER_COLORS = [
  '#1E4D8C', // azure (app accent)
  '#B85040', // persimmon
  '#3F7D7D', // teal
  '#8A6A45', // warm brown
  '#6B7B4A', // olive
  '#7D5A8C', // muted plum
  '#C08A2D', // ochre
  '#4A6B8A', // slate blue
];

/** Pick the next color not already used, falling back to round-robin. */
export function nextColor(used: string[]): string {
  const free = MEMBER_COLORS.find((c) => !used.includes(c));
  return free ?? MEMBER_COLORS[used.length % MEMBER_COLORS.length];
}
