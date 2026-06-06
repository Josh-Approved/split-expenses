/**
 * Stable random ids for records (members, expenses, settlements, groups).
 * Not security-sensitive — the shared-sync secret has its own CSPRNG path
 * (sync/crypto.ts). These only need to be collision-resistant across devices.
 */

export function newId(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback: time + random, ample entropy for record ids.
  const rand = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${Date.now().toString(16)}-${rand()}-${rand()}`;
}
