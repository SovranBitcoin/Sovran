import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View as NativeView } from 'react-native';
import { create } from 'zustand';

import { View } from '@/shared/ui/primitives/View/View';
import { isCustomSheetPayload, usePopupStore } from '@/shared/stores/runtime/popupStore';
import { serializeE2EActionMenuTarget } from '@/shared/lib/e2e/actionMenuTarget';

const E2E_ACTION_MENU_OPEN_ID = 'e2e-action-menu-open';
const E2E_HEROUI_MENU_OPEN_ID = 'e2e-heroui-menu-open';

/** State belongs in the id on Android: RN merges a labeled non-editable
 * node's accessibilityValue into content-desc, which cannot be separated
 * reliably by uiautomator. */
export const e2eMenuStateId = (baseId: string, state: string): string =>
  `${baseId}:${encodeURIComponent(state || 'untitled')}`;

type E2EActionMenuRenderState = {
  sequence: number;
  renderedSequence: number | null;
  renderedOpenSeq: number | null;
  presentedOpenSeq: number | null;
  show: (openSeq: number) => number;
  present: (openSeq: number) => void;
  clear: (sequence: number) => void;
};

/** Exported for the e2e state-mirror so a run's sidecar exposes the render/
 * present gate state — the only way to diagnose why the FWO action-menu probe
 * fails to light for a given sheet (dev-only; never read in product paths). */
export const useE2EActionMenuRenderStore = create<E2EActionMenuRenderState>((set, get) => ({
  sequence: 0,
  renderedSequence: null,
  renderedOpenSeq: null,
  presentedOpenSeq: null,
  show: (openSeq) => {
    const sequence = get().sequence + 1;
    set({
      sequence,
      renderedSequence: sequence,
      renderedOpenSeq: openSeq,
      presentedOpenSeq: get().presentedOpenSeq === openSeq ? openSeq : null,
    });
    return sequence;
  },
  present: (openSeq) => set({ presentedOpenSeq: openSeq }),
  clear: (sequence) => {
    if (get().renderedSequence === sequence) {
      set({ renderedSequence: null, renderedOpenSeq: null, presentedOpenSeq: null });
    }
  },
}));

type E2EActionMenuTarget = {
  actionId: string;
  openSeq: number;
  registration: number;
  x: number;
  y: number;
};

type E2EActionMenuTargetState = {
  targets: Record<string, E2EActionMenuTarget>;
  setTarget: (target: E2EActionMenuTarget) => void;
  clearTarget: (actionId: string, registration: number) => void;
};

/** Exported for focused tests and state diagnosis. Coordinates are transient,
 * non-secret screen geometry; the store is populated only by an owned e2e
 * Metro on iOS. */
export const useE2EActionMenuTargetStore = create<E2EActionMenuTargetState>((set) => ({
  targets: {},
  setTarget: (target) =>
    set((state) => ({ targets: { ...state.targets, [target.actionId]: target } })),
  clearTarget: (actionId, registration) =>
    set((state) => {
      if (state.targets[actionId]?.registration !== registration) return state;
      const targets = { ...state.targets };
      delete targets[actionId];
      return { targets };
    }),
}));

let nextTargetRegistration = 0;

const actionTargetBridgeEnabled = (): boolean =>
  __DEV__ && Platform.OS === 'ios' && process.env.EXPO_PUBLIC_E2E_STATE_MIRROR === '1';

/**
 * Measure a real FullWindowOverlay menu row after the native sheet reaches its
 * presented snap point. `E2EActionMenuProbe` mirrors the stable action testID
 * into the main AX window with this measured centre in its value. The iOS
 * driver can therefore address the action semantically and still issue a real
 * physical tap on the production row, without authored screen coordinates.
 */
export function E2EActionMenuTargetMarker({
  actionId,
  disabled = false,
}: {
  actionId?: string;
  disabled?: boolean;
}): React.ReactElement | null {
  const targetRef = useRef<NativeView>(null);
  const [registration] = useState(() => ++nextTargetRegistration);
  const openSeq = usePopupStore((state) => state.openSeq);
  const presentedOpenSeq = useE2EActionMenuRenderStore((state) => state.presentedOpenSeq);
  const enabled = !!actionId && !disabled && actionTargetBridgeEnabled();

  const measure = useCallback(() => {
    if (!enabled || !actionId || presentedOpenSeq !== openSeq) return;
    targetRef.current?.measureInWindow((x, y, width, height) => {
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      if (width <= 0 || height <= 0 || !Number.isFinite(centerX) || !Number.isFinite(centerY)) {
        return;
      }
      useE2EActionMenuTargetStore.getState().setTarget({
        actionId,
        openSeq,
        registration,
        x: centerX,
        y: centerY,
      });
    });
  }, [actionId, enabled, openSeq, presentedOpenSeq, registration]);

  useEffect(() => {
    if (!enabled || presentedOpenSeq !== openSeq) return;
    // The first frame commits the presented state; the second samples the row
    // after gorhom has applied its final native transform.
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(measure);
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [enabled, measure, openSeq, presentedOpenSeq]);

  useEffect(
    () => () => {
      if (actionId) {
        useE2EActionMenuTargetStore.getState().clearTarget(actionId, registration);
      }
    },
    [actionId, registration]
  );

  if (!enabled) return null;
  return (
    <NativeView
      ref={targetRef}
      collapsable={false}
      pointerEvents="none"
      onLayout={measure}
      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
    />
  );
}

/** Called by PopupHost only after gorhom reports an opened native snap point.
 * React content mounts while the sheet is still closed, so render alone is not
 * sufficient evidence that a coordinate press will hit a visible menu row. */
export function markE2EActionMenuPresented(openSeq: number): void {
  if (!__DEV__) return;
  useE2EActionMenuRenderStore.getState().present(openSeq);
}

/** Published from inside the real FullWindowOverlay sheet body. The root-tree
 * probe must not claim the menu is ready merely because popup state requested
 * it: native sheet presentation can fail or lag behind that state transition. */
export function E2EActionMenuRenderMarker({
  presentationKey,
}: {
  presentationKey: unknown;
}): React.ReactElement | null {
  useEffect(() => {
    if (!__DEV__) return;
    const openSeq = usePopupStore.getState().openSeq;
    const sequence = useE2EActionMenuRenderStore.getState().show(openSeq);
    return () => useE2EActionMenuRenderStore.getState().clear(sequence);
  }, [presentationKey]);
  return null;
}

// ── heroui ActionMenuHost mirror ─────────────────────────────────────────────
// `actionMenuPopup()` renders through the heroui-native Menu in ActionMenuHost
// (a gorhom sheet inside a FullWindowOverlay), NOT through the popupStore
// sheets the probe above watches. Its content is equally AX-invisible, so the
// host publishes its open payload title here and a root-tree mirror exposes
// it. Only the non-secret payload title crosses this DEV-only seam.

const useE2EHerouiMenuStore = create<{ title: string | null }>(() => ({ title: null }));

/** Published by ActionMenuHost whenever its payload opens (title, '' when the
 * payload has none) or closes (null). */
export function markE2EHerouiMenu(title: string | null): void {
  if (!__DEV__) return;
  useE2EHerouiMenuStore.setState({ title });
}

/** Dev-only 1×1 mirror of the heroui action-menu open state; mount on screens
 * whose scenarios must observe an `actionMenuPopup` (e.g. the wallet home's
 * camera-permission menu). `accessibilityValue` carries the menu title. */
export function E2EHerouiMenuProbe(): React.ReactElement | null {
  const title = useE2EHerouiMenuStore((state) => state.title);
  if (!__DEV__ || title === null) return null;
  return (
    <>
      <View
        testID={E2E_HEROUI_MENU_OPEN_ID}
        accessible
        accessibilityRole="text"
        accessibilityLabel="Heroui menu open"
        accessibilityValue={{ text: title }}
        importantForAccessibility="yes"
        collapsable={false}
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1 }}
      />
      <View
        testID={e2eMenuStateId(E2E_HEROUI_MENU_OPEN_ID, title)}
        accessible
        accessibilityRole="text"
        accessibilityLabel="Heroui menu state"
        importantForAccessibility="yes"
        collapsable={false}
        pointerEvents="none"
        style={{ position: 'absolute', left: 1, top: 0, width: 1, height: 1 }}
      />
    </>
  );
}

/** Dev-only, non-secret evidence that the FullWindowOverlay action menu has
 * been requested. Its rows are not present in iOS AX, so simulator plans wait
 * for this marker before performing a coordinate selection. */
export function E2EActionMenuProbe(): React.ReactElement | null {
  const renderedSequence = useE2EActionMenuRenderStore((state) => state.renderedSequence);
  const renderedOpenSeq = useE2EActionMenuRenderStore((state) => state.renderedOpenSeq);
  const presentedOpenSeq = useE2EActionMenuRenderStore((state) => state.presentedOpenSeq);
  const openSeq = usePopupStore((state) => state.openSeq);
  const actionTargets = useE2EActionMenuTargetStore((state) => state.targets);
  const openSheetId = usePopupStore((state) =>
    state.isOpen &&
    isCustomSheetPayload(state.current) &&
    // Any FullWindowOverlay sheet whose rows need coordinate selection: the
    // classic action menu, the offline proof-selector ("Choose amount"), and
    // the NIP-46 signer connect approval.
    (state.current.sheetId === 'action-menu' ||
      state.current.sheetId === 'proof-selector' ||
      state.current.sheetId === 'signer-connect' ||
      state.current.sheetId === 'model-picker')
      ? state.current.sheetId
      : null
  );
  const actionMenuOpen = openSheetId != null;
  if (
    !__DEV__ ||
    !actionMenuOpen ||
    renderedSequence == null ||
    renderedOpenSeq !== openSeq ||
    presentedOpenSeq !== openSeq
  ) {
    return null;
  }
  const presentedTargets = Object.values(actionTargets).filter(
    (target) => target.openSeq === openSeq
  );
  return (
    <>
      <View
        testID={E2E_ACTION_MENU_OPEN_ID}
        accessible
        accessibilityRole="text"
        accessibilityLabel="Action menu open"
        accessibilityValue={{ text: openSheetId ?? '' }}
        importantForAccessibility="yes"
        collapsable={false}
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1 }}
      />
      <View
        testID={e2eMenuStateId(E2E_ACTION_MENU_OPEN_ID, openSheetId ?? '')}
        accessible
        accessibilityRole="text"
        accessibilityLabel="Action menu state"
        importantForAccessibility="yes"
        collapsable={false}
        pointerEvents="none"
        style={{ position: 'absolute', left: 1, top: 0, width: 1, height: 1 }}
      />
      {actionTargetBridgeEnabled() && openSheetId === 'action-menu'
        ? presentedTargets.map((target) => (
            <View
              key={`${target.actionId}-${target.registration}`}
              testID={target.actionId}
              accessible
              accessibilityRole="button"
              accessibilityLabel={`Action menu choice ${target.actionId}`}
              accessibilityValue={{ text: serializeE2EActionMenuTarget(target) }}
              importantForAccessibility="yes"
              collapsable={false}
              pointerEvents="none"
              style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1 }}
            />
          ))
        : null}
    </>
  );
}
