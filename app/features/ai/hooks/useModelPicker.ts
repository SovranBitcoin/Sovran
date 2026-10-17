import { useEffect, useRef } from 'react';

import { log } from '@/shared/lib/logger';
import { openPicker } from '@/shared/lib/picker/openPicker';
import type { PickerSession } from '@/shared/lib/picker/types';
import { paramPopup } from '@/shared/lib/popup';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

import { AI_TIERS, providersForLineup } from '../lib/format';
import { modelOptionId, modelPickerRequest, modelPickerState } from '../lib/modelPickerRequest';
import { useRoutstrFunds } from './useRoutstrFunds';

const pickerLog = log.child({ module: 'modelPicker' });

/**
 * Opens the AI model picker in the picker sheet, and keeps the open sheet
 * current while the balance, the catalog or the selection change underneath.
 * Returns the function that opens it.
 */
export function useModelPicker(): () => void {
  const lineup = useRoutstrStore((s) => s.lineup);
  const lastKnownLineup = useRoutstrStore((s) => s.lastKnownLineup);
  const modelsCache = useRoutstrStore((s) => s.modelsCache);
  const selectedProvider = useRoutstrStore((s) => s.selectedProvider);
  const selectedTier = useRoutstrStore((s) => s.selectedTier);
  const balanceSats = useRoutstrFunds()?.balanceSats ?? 0;
  const state = modelPickerState(
    { lineup, lastKnownLineup, modelsCache, selectedProvider, selectedTier },
    balanceSats
  );
  const request = modelPickerRequest(state);

  const session = useRef<PickerSession | null>(null);
  useEffect(() => {
    session.current?.update(request);
  }, [request]);

  return () => {
    pickerLog.info('modelPicker.invoke', { selectedProvider, selectedTier });
    const picker = openPicker(request);
    session.current = picker;
    void picker.result.then(async (result) => {
      if (session.current === picker) session.current = null;
      if (result.kind !== 'option') return;
      const slot = providersForLineup(state.lineup)
        .flatMap((provider) => AI_TIERS.map((tier) => ({ provider, tier })))
        .find(({ provider, tier }) => modelOptionId(provider.id, tier.id) === result.id);
      // Picking the current model again only closes the sheet.
      if (!slot || (slot.provider.id === selectedProvider && slot.tier.id === selectedTier)) {
        return;
      }
      pickerLog.info('modelPicker.select', { provider: slot.provider.id, tier: slot.tier.id });
      useRoutstrStore
        .getState()
        .setSelectedSlot({ provider: slot.provider.id, tier: slot.tier.id });
      // The toast sits beneath a system sheet, so it waits for the sheet to go.
      await picker.closed;
      paramPopup('model-switched', { modelName: `${slot.provider.label} ${slot.tier.label}` });
    });
  };
}
