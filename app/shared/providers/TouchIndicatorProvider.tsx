import type { ReactNode } from 'react';

import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { TouchIndicatorEnabled, TouchIndicatorLayer } from '@/shared/ui/composed/TouchIndicator';

/**
 * Draws taps when the recording setting is on. `shared/ui` reads no store, so
 * the setting reaches every layer through this provider, which also mounts
 * the outermost one: it covers whatever is not inside a screen, a sheet or a
 * popup of its own (the wallet home, the tab bar, the drawer).
 */
export function TouchIndicatorProvider({ children }: { children: ReactNode }) {
  const showTouches = useSettingsStore((s) => s.showTouches);
  return (
    <TouchIndicatorEnabled.Provider value={showTouches}>
      <TouchIndicatorLayer>{children}</TouchIndicatorLayer>
    </TouchIndicatorEnabled.Provider>
  );
}
