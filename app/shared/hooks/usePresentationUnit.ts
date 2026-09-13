import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useMockDataStore } from '@/shared/stores/runtime/mockDataStore';
import type { ActiveUnit } from '@/shared/stores/profile/mintStore';

/** Wallpaper and screenshot selection only. Payment contexts retain the live unit. */
export function usePresentationUnit(liveUnit: ActiveUnit): ActiveUnit {
  const mockMode = useSettingsStore((state) => state.mockMode);
  const mockUnit = useMockDataStore((state) => state.walletUnit);
  return mockMode ? mockUnit : liveUnit;
}
