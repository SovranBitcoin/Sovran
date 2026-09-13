import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { MOCK_WALLET_UNITS, useMockDataStore } from '@/shared/stores/runtime/mockDataStore';
import { useActiveUnit } from './useActiveUnit';

/** Opt-in display surface: mock selection cannot offer a unit to a payment flow. */
export function useWalletPresentationUnit(presentation = true) {
  const live = useActiveUnit();
  const mockMode = useSettingsStore((state) => state.mockMode);
  const unit = useMockDataStore((state) => state.walletUnit);
  const selectUnit = useMockDataStore((state) => state.setWalletUnit);
  return mockMode && presentation ? { unit, availableUnits: MOCK_WALLET_UNITS, selectUnit } : live;
}
