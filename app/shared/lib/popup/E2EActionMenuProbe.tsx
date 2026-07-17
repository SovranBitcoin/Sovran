import React, { useEffect } from 'react';
import { create } from 'zustand';

import { View } from '@/shared/ui/primitives/View/View';
import { isCustomSheetPayload, usePopupStore } from '@/shared/stores/runtime/popupStore';

export const E2E_ACTION_MENU_OPEN_ID = 'e2e-action-menu-open';

type E2EActionMenuRenderState = {
  sequence: number;
  renderedSequence: number | null;
  renderedOpenSeq: number | null;
  presentedOpenSeq: number | null;
  show: (openSeq: number) => number;
  present: (openSeq: number) => void;
  clear: (sequence: number) => void;
};

const useE2EActionMenuRenderStore = create<E2EActionMenuRenderState>((set, get) => ({
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

/** Dev-only, non-secret evidence that the FullWindowOverlay action menu has
 * been requested. Its rows are not present in iOS AX, so simulator plans wait
 * for this marker before performing a coordinate selection. */
export function E2EActionMenuProbe(): React.ReactElement | null {
  const renderedSequence = useE2EActionMenuRenderStore((state) => state.renderedSequence);
  const renderedOpenSeq = useE2EActionMenuRenderStore((state) => state.renderedOpenSeq);
  const presentedOpenSeq = useE2EActionMenuRenderStore((state) => state.presentedOpenSeq);
  const openSeq = usePopupStore((state) => state.openSeq);
  const openSheetId = usePopupStore((state) =>
    state.isOpen &&
    isCustomSheetPayload(state.current) &&
    // Any FullWindowOverlay sheet whose rows need coordinate selection: the
    // classic action menu, the offline proof-selector ("Choose amount"), and
    // the NIP-46 signer connect approval.
    (state.current.sheetId === 'action-menu' ||
      state.current.sheetId === 'proof-selector' ||
      state.current.sheetId === 'signer-connect')
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
  return (
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
  );
}
