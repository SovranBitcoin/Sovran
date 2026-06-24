/**
 * @fileoverview Capability port — what UI code asks: "do we support liquid
 * glass / blur / mesh gradient right now?"
 *
 * Two adapters today:
 * - `<CapabilityProvider />` (production) — subscribes to `useSettingsStore`
 *   for `mockNoGlass` so flipping the dev toggle re-renders every consumer
 *   without a relaunch.
 * - `<CapabilityProvider value={fakeCaps}>` (test) — pass a literal so tests
 *   render every variant without jest module mocks for `version.ts`.
 *
 * Module-scope callers (`navigation/nativeTabs.tsx`, worklets) keep using
 * the sync helpers in `shared/lib/version.ts`.
 */

import React, { createContext, useContext } from 'react';

import { useSettingsStore } from '@/shared/stores/global/settingsStore';

import { detectCapabilities } from './detect';
import type { Capabilities } from './types';

export { defineVariants } from './defineVariants';

const CapabilityContext = createContext<Capabilities | null>(null);

interface CapabilityProviderProps {
  /** Override for tests / Storybook. When omitted, computes from real Platform + settings. */
  value?: Capabilities;
  children: React.ReactNode;
}

export function CapabilityProvider({
  value,
  children,
}: CapabilityProviderProps): React.ReactElement {
  const mockNoGlass = useSettingsStore((s) => s.mockNoGlass);
  const detected = value ?? detectCapabilities({ mockNoGlass });
  return <CapabilityContext.Provider value={detected}>{children}</CapabilityContext.Provider>;
}

/**
 * React-aware capability read. Re-renders when `mockNoGlass` flips.
 * Throws if called outside `<CapabilityProvider />` — every render path in
 * the app sits under one, so this is a configuration error not a runtime
 * fallback.
 */
export function useCapabilities(): Capabilities {
  const v = useContext(CapabilityContext);
  if (!v) {
    throw new Error('useCapabilities() called outside <CapabilityProvider />');
  }
  return v;
}
