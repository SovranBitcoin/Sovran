import type { Bip321ExcludedRails, Bip321RailId } from '@/shared/stores/profile/mintStore';

export interface Bip321Rail {
  id: Bip321RailId;
  label: string;
  state: 'included' | 'unavailable' | 'off';
  reason?: string;
}

export interface Bip321RailSelection {
  rails: Bip321Rail[];
  enabledCount: number;
  needsExclusionReset: boolean;
}

export const REASON_LAST_RAIL = 'At least one method is required';

const RAILS = [
  { id: 'onchain', label: 'Onchain' },
  { id: 'bolt12', label: 'BOLT 12' },
  { id: 'creq', label: 'Cashu' },
] as const;

/** Exclusions affect advertisement only; old requests remain receivable. */
export function deriveBip321RailSelection({
  available,
  excluded,
}: {
  available: Record<Bip321RailId, boolean>;
  excluded: Bip321ExcludedRails;
}): Bip321RailSelection {
  const candidates = RAILS.filter(({ id }) => available[id]);
  const enabled = candidates.filter(({ id }) => !excluded[id]);
  // A capability/unit change may leave only previously excluded rails.
  // Restore the available set synchronously, then let the owner persist it.
  const needsExclusionReset = candidates.length > 0 && enabled.length === 0;
  const enabledCount = needsExclusionReset ? candidates.length : enabled.length;

  return {
    rails: RAILS.map((rail) => {
      if (!available[rail.id]) {
        return { ...rail, state: 'unavailable', reason: `${rail.label} is unavailable` };
      }
      if (excluded[rail.id] && !needsExclusionReset) return { ...rail, state: 'off' };
      return {
        ...rail,
        state: 'included',
        ...(enabledCount === 1 ? { reason: REASON_LAST_RAIL } : {}),
      };
    }),
    enabledCount,
    needsExclusionReset,
  };
}
