/**
 * Whether a unit-denominated wallet record (history entry, balance row, quote)
 * belongs to an ACCOUNT unit: same mint unit, and its mint on the same side of
 * the testnut split (wallet `units/accounts`). `'all'` matches everything; a
 * record without a mint cannot be classified and matches on unit alone.
 */
import { isTestnutUnit, toRealUnit } from 'wallet/units';

export function belongsToAccount(
  accountUnit: string,
  record: { unit?: string | null; mintUrl?: string | null },
  isTestnutMint: (mintUrl: string) => boolean
): boolean {
  if (accountUnit === 'all') return true;
  if ((record.unit ?? 'sat') !== toRealUnit(accountUnit)) return false;
  return !record.mintUrl || isTestnutMint(record.mintUrl) === isTestnutUnit(accountUnit);
}
