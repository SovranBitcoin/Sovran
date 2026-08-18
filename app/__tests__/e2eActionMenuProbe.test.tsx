/**
 * @jest-environment node
 */

import { Platform } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import {
  E2EActionMenuProbe,
  E2EActionMenuRenderMarker,
  E2EHerouiMenuProbe,
  e2eMenuStateId,
  markE2EActionMenuPresented,
  markE2EHerouiMenu,
  useE2EActionMenuTargetStore,
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
  const originalE2EStateMirror = process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  });

  afterEach(() => {
    act(() => usePopupStore.getState().close());
    act(() => markE2EHerouiMenu(null));
    act(() => useE2EActionMenuTargetStore.setState({ targets: {} }));
    if (originalE2EStateMirror === undefined) {
      delete process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
    } else {
      process.env.EXPO_PUBLIC_E2E_STATE_MIRROR = originalE2EStateMirror;
    }
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
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

    const presentedProbe = renderer!.root.findByProps({ testID: 'e2e-action-menu-open' });
    expect(presentedProbe.props.accessibilityValue).toEqual({ text: 'action-menu' });
    expect(presentedProbe.props.importantForAccessibility).toBe('yes');
    expect(presentedProbe.props.collapsable).toBe(false);
    expect(presentedProbe.props.pointerEvents).toBe('none');
    const stateProbe = renderer!.root.findByProps({
      testID: 'e2e-action-menu-open:action-menu',
    });
    expect(stateProbe.props.accessibilityValue).toBeUndefined();

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

  it('mirrors heroui menu state in an Android-safe dynamic id', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<E2EHerouiMenuProbe />);
      markE2EHerouiMenu('Conversations & history');
    });

    const stateId = e2eMenuStateId('e2e-heroui-menu-open', 'Conversations & history');
    expect(stateId).toBe('e2e-heroui-menu-open:Conversations%20%26%20history');
    const stateProbe = renderer!.root.findByProps({ testID: stateId });
    expect(stateProbe.props.accessibilityLabel).toBe('Heroui menu state');
    expect(stateProbe.props.accessibilityValue).toBeUndefined();

    act(() => renderer!.unmount());
  });

  it('mirrors a measured iOS menu row under its stable action id only in e2e', () => {
    process.env.EXPO_PUBLIC_E2E_STATE_MIRROR = '1';
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<E2EActionMenuProbe />);
      usePopupStore.getState().open({
        sheetId: 'action-menu',
        payload: { buttons: [] },
      });
    });
    act(() => {
      renderer!.update(
        <>
          <E2EActionMenuRenderMarker presentationKey="semantic-action" />
          <E2EActionMenuProbe />
        </>
      );
    });
    const openSeq = usePopupStore.getState().openSeq;
    act(() => markE2EActionMenuPresented(openSeq));
    act(() =>
      useE2EActionMenuTargetStore.getState().setTarget({
        actionId: 'send-token-cancel-transaction',
        openSeq,
        registration: 1,
        x: 196.25,
        y: 713.875,
      })
    );

    const action = renderer!.root.findByProps({ testID: 'send-token-cancel-transaction' });
    expect(action.props.accessibilityRole).toBe('button');
    expect(action.props.accessibilityValue).toEqual({
      text: 'e2e-action-menu-target:196.250:713.875',
    });

    act(() => renderer!.unmount());
  });
});
