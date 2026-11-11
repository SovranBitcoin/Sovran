import { selectLineup, useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { getProviderById, getTierById, resolveSelectedEntry } from '../lib/format';
import { useRoutstrFunds } from './useRoutstrFunds';

/** The selected slot and the model it resolves to for the wallet's sats: what the chip names. */
export function useSelectedModel() {
  const currentProvider = getProviderById(useRoutstrStore((s) => s.selectedProvider));
  const currentTier = getTierById(useRoutstrStore((s) => s.selectedTier));
  const lineup = useRoutstrStore(selectLineup);
  const balanceSats = useRoutstrFunds()?.balanceSats ?? 0;
  const resolvedEntry = resolveSelectedEntry(
    currentProvider.id,
    currentTier.id,
    balanceSats,
    lineup
  );
  return { currentProvider, currentTier, lineup, balanceSats, resolvedEntry };
}
