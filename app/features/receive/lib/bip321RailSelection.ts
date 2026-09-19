import type { Bip321RailId } from '@/shared/stores/profile/mintStore';

export interface Bip321Rail {
  id: Bip321RailId;
  label: string;
  state: 'included' | 'unavailable';
  reason?: string;
}

export interface Bip321RailSelection {
  rails: Bip321Rail[];
}

const RAILS = [
  { id: 'onchain', label: 'Onchain' },
  { id: 'bolt12', label: 'BOLT 12' },
  { id: 'creq', label: 'Cashu' },
] as const;

/** The Unified request carries every rail a trusted mint can serve. */
export function deriveBip321RailSelection({
  available,
}: {
  available: Record<Bip321RailId, boolean>;
}): Bip321RailSelection {
  return {
    rails: RAILS.map((rail) =>
      available[rail.id]
        ? { ...rail, state: 'included' }
        : { ...rail, state: 'unavailable', reason: `${rail.label} is unavailable` }
    ),
  };
}
