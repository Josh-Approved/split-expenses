/**
 * Regression: a timestamp TIE on a group's scalar head fields must converge.
 *
 * Two paired devices concurrently rename the group AND change its base currency
 * in the SAME millisecond (equal `updatedAt`). The old `localNewer = local >= remote`
 * head-pick kept each device's OWN name/currency, so the two never converged —
 * a permanent divergence. The fix breaks the tie with a device-independent key
 * of the tie-relevant scalar fields, so both devices pick the identical winner.
 *
 * This test asserts cross-ORDER convergence (device A runs mergeGroup(A, B),
 * device B runs mergeGroup(B, A)); the pre-fix keep-local code fails it because
 * the two orders keep different heads.
 */
import { mergeGroup } from '../mergeGroup';
import type { Group } from '../../data/types';

const SECRET = 'shared-secret-tiebreak';
const AT = 1_700_000_000_000; // identical updatedAt on both devices → the tie

function group(id: string, name: string, baseCurrency: string): Group {
  return {
    id,
    name,
    baseCurrency,
    members: [],
    expenses: [],
    settlements: [],
    shareIdentity: { secret: SECRET, createdAt: AT },
    createdAt: AT,
    updatedAt: AT,
  };
}

test('a name+currency tie converges to the same head on both devices (both merge orders)', () => {
  // Two devices, different local ids, edited concurrently at the SAME instant.
  const a = group('g_a', 'Ski trip', 'USD');
  const b = group('g_b', 'Weekend away', 'EUR');

  // Device A merges its copy against B's; device B merges the mirror order.
  const onA = mergeGroup(a, b);
  const onB = mergeGroup(b, a);

  // Both devices must land on the SAME name and SAME base currency.
  expect(onA.name).toBe(onB.name);
  expect(onA.baseCurrency).toBe(onB.baseCurrency);

  // And the winning pair must be internally consistent (name + currency come
  // from the same head, never a mix).
  const heads = [
    { name: 'Ski trip', baseCurrency: 'USD' },
    { name: 'Weekend away', baseCurrency: 'EUR' },
  ];
  expect(heads).toContainEqual({ name: onA.name, baseCurrency: onA.baseCurrency });
});

test('a tie stays stable when the same device re-merges in the opposite order', () => {
  const a = group('g_a', 'Alpha', 'USD');
  const b = group('g_b', 'Beta', 'GBP');

  // Same device, both merge orders — a deterministic tie-break is order-independent.
  const forward = mergeGroup(a, b);
  const backward = mergeGroup(b, a);

  expect(forward.name).toBe(backward.name);
  expect(forward.baseCurrency).toBe(backward.baseCurrency);
});
