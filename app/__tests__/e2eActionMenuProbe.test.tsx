/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  E2EActionMenuProbe,
  E2EActionMenuRenderMarker,
  markE2EActionMenuPresented,
} from '@/shared/lib/popup/E2EActionMenuProbe';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/ui/primitives/View/View', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    View: (props: Record<string, unknown>) => ReactActual.createElement('div', props),
  };
});

describe('DEV action-menu render probe', () => {
  afterEach(() => {
    act(() => usePopupStore.getState().close());
  });

  it('appears only after the FullWindowOverlay menu content actually renders', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<E2EActionMenuProbe />);
      usePopupStore.getState().open({
        sheetId: 'action-menu',
        payload: { buttons: [] },
      });
    });

    expect(renderer!.root.findAllByProps({ testID: 'e2e-action-menu-open' })).toHaveLength(0);

    act(() => {
      renderer!.update(
        <>
          <E2EActionMenuRenderMarker presentationKey="cycle-1" />
          <E2EActionMenuProbe />
        </>
      );
    });

    expect(renderer!.root.findAllByProps({ testID: 'e2e-action-menu-open' })).toHaveLength(0);
    act(() => markE2EActionMenuPresented(usePopupStore.getState().openSeq));

    expect(renderer!.root.findByProps({ testID: 'e2e-action-menu-open' })).toBeDefined();

    // Closing and immediately requesting another menu used to expose the old
    // render marker while its native exit animation was still mounted. That
    // let a coordinate tap hit the route below the not-yet-presented sheet.
    act(() => {
      usePopupStore.getState().close();
      usePopupStore.getState().open({
        sheetId: 'action-menu',
        payload: { buttons: [] },
      });
    });
    expect(renderer!.root.findAllByProps({ testID: 'e2e-action-menu-open' })).toHaveLength(0);

    act(() => {
      renderer!.update(
        <>
          <E2EActionMenuRenderMarker presentationKey="cycle-2" />
          <E2EActionMenuProbe />
        </>
      );
    });
    expect(renderer!.root.findAllByProps({ testID: 'e2e-action-menu-open' })).toHaveLength(0);
    act(() => markE2EActionMenuPresented(usePopupStore.getState().openSeq));
    expect(renderer!.root.findByProps({ testID: 'e2e-action-menu-open' })).toBeDefined();

    act(() => renderer!.update(<E2EActionMenuProbe />));
    expect(renderer!.root.findAllByProps({ testID: 'e2e-action-menu-open' })).toHaveLength(0);

    act(() => renderer!.unmount());
  });
});
