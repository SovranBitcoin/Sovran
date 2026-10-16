import type { ReactNode } from 'react';

import { IS_E2E_LOG_BUILD } from '@/shared/lib/logger';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { TouchIndicatorEnabled, TouchIndicatorLayer } from '@/shared/ui/composed/TouchIndicator';

/**
 * Draws taps when the recording setting is on. `shared/ui` reads no store, so
 * the setting reaches every layer through this provider, which also mounts
 * the outermost one: it covers whatever is not inside a screen, a sheet or a
 * popup of its own (the wallet home, the tab bar, the drawer).
 *
 * The end-to-end test build always draws them: its recordings should show
 * where each tap landed, and its runner waits on the entry a drawn touch logs.
 */
export function TouchIndicatorProvider({ children }: { children: ReactNode }) {
  const showTouches = useSettingsStore((s) => s.showTouches) || IS_E2E_LOG_BUILD;
  return (
    <TouchIndicatorEnabled.Provider value={showTouches}>
      <TouchIndicatorLayer>{children}</TouchIndicatorLayer>
    </TouchIndicatorEnabled.Provider>
  );
}
