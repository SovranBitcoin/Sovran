import { useEffect, useState } from 'react';
import { useManager, useMints } from '@cashu/coco-react';

import { getMintKeysetUnits } from '@/shared/lib/cashu/managerInternals';
import { walletLog } from '@/shared/lib/logger';

/**
 * Units each trusted mint actually holds keysets for, keyed by mint URL.
 * `undefined` for a mint means "not known yet" — consumers must treat that
 * as unrestricted (trust the NUT-04 advertisement) so a slow DB read never
 * hides a genuinely supported unit.
 *
 * Why this exists: some mints advertise NUT-04/05 method-units they have no
 * keysets for (chorus lists bolt11/usd with sat-only keysets); offering such
 * a unit ends in coco's "No valid keysets found" at quote creation. Reads
 * coco's local keyset DB (no network) and refreshes when the trusted-mint
 * set changes or coco updates a mint.
 */
export function useMintKeysetUnits(): Record<string, string[] | undefined> {
  const manager = useManager();
  const { trustedMints } = useMints();
  const [unitsByMint, setUnitsByMint] = useState<Record<string, string[] | undefined>>({});

  useEffect(() => {
    if (!manager) return;
    let cancelled = false;

    const load = async () => {
      const entries = await Promise.all(
        trustedMints.map(async (mint) => {
          try {
            return [mint.mintUrl, await getMintKeysetUnits(manager, mint.mintUrl)] as const;
          } catch {
            // Unknown, not empty — a read failure must not report "issues nothing".
            return [mint.mintUrl, undefined] as const;
          }
        })
      );
      if (cancelled) return;
      const next = Object.fromEntries(entries);
      setUnitsByMint((prev) => {
        const prevKeys = Object.keys(prev);
        const unchanged =
          prevKeys.length === entries.length &&
          entries.every(([url, units]) => {
            const before = prev[url];
            return (
              before === units ||
              (Array.isArray(before) &&
                Array.isArray(units) &&
                before.length === units.length &&
                before.every((u, i) => u === units[i]))
            );
          });
        if (unchanged) return prev;
        walletLog.debug('wallet.unit.keyset_units', {
          mintCount: entries.length,
          summary: entries.map(([, units]) => units?.join('+') ?? '?').join(','),
        });
        return next;
      });
    };

    void load();
    // Keyset rows change when coco adds/refreshes a mint — re-read then.
    const offAdded = manager.on('mint:added', () => void load());
    const offUpdated = manager.on('mint:updated', () => void load());
    return () => {
      cancelled = true;
      offAdded();
      offUpdated();
    };
  }, [manager, trustedMints]);

  return unitsByMint;
}
