import type { ReactNode } from 'react';

import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { LayoutGuides, LayoutGuidesEnabled } from '@/shared/ui/composed/LayoutGuides';

/**
 * Draws the layout guides above everything it wraps when the review setting
 * is on. `shared/ui` reads no store, so the setting reaches the guides through
 * this provider.
 */
export function LayoutGuidesProvider({ children }: { children: ReactNode }) {
  const guides = useSettingsStore((s) => s.layoutGuides);
  return (
    <LayoutGuidesEnabled.Provider value={guides}>
      {children}
      <LayoutGuides />
    </LayoutGuidesEnabled.Provider>
  );
}
