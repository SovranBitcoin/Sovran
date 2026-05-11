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

import React, { createContext, useContext, useMemo } from 'react';

import { liquidGlassModifiers as syncLiquidGlassModifiers } from '@/shared/lib/version';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

import { detectCapabilities } from './detect';
import type { Capabilities } from './types';

export type { Capabilities, IconSource } from './types';
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
  const detected = useMemo(
    () => value ?? detectCapabilities({ mockNoGlass }),
    [value, mockNoGlass]
  );
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

/**
 * Hook variant of `liquidGlassModifiers()`. Use this from inside React render
 * so the consumer re-renders when `mockNoGlass` flips. Module-scope callers
 * (worklets, native tabs) should keep using the sync helper from `version.ts`.
 */
export function useLiquidGlassModifiers<T>(...modifiers: T[]): T[] {
  const { liquidGlass } = useCapabilities();
  return liquidGlass ? modifiers : [];
}

// Re-export the sync helper here too so component code only needs one import
// path. The sync version reads `useSettingsStore.getState()` directly and is
// safe to call from worklets / module scope.
export { syncLiquidGlassModifiers as liquidGlassModifiers };
