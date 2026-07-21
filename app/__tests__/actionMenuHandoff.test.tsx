/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { ActionMenuHost } from '@/shared/blocks/popup/ActionMenuHost';
import {
  E2EActionMenuProbe,
  E2EActionMenuRenderMarker,
  markE2EActionMenuPresented,
  useE2EActionMenuRenderStore,
} from '@/shared/lib/popup/E2EActionMenuProbe';
import { actionMenuPopup, dismissActionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: readonly string[]) => tokens.map(String),
}));

jest.mock('@/shared/lib/logger', () => {
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  };
  return {
    log: { ...logger, child: () => logger },
    storeLog: logger,
    redactError: (error: unknown) => error,
  };
});

jest.mock('@/shared/lib/scheduleAfterLayout', () => ({
  scheduleAfterLayout: (callback: () => void) => {
    callback();
    return undefined;
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

jest.mock('@/shared/ui/primitives/Pressable', () => ({
  Pressable: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Pressable', props, children);
  },
}));

jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Text', props, children);
  },
}));

jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('View', props, children);
  },
}));

jest.mock('@/shared/ui/primitives/View/VStack', () => ({
  VStack: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('VStack', props, children);
  },
}));

jest.mock('@/shared/ui/primitives/View/HStack', () => ({
  HStack: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('HStack', props, children);
  },
}));

jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('BottomButtons', props, children);
  },
}));

jest.mock('@/shared/ui/composed/SectionAnchorList', () => ({
  SectionAnchorList: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('SectionAnchorList', props);
  },
}));

jest.mock('@/shared/blocks/popup/MenuScrim', () => ({
  MenuScrim: () => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('MenuScrim');
  },
}));

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const component = (name: string) =>
    function MockBottomSheetComponent({ children, ...props }: { children?: React.ReactNode }) {
      return ReactActual.createElement(name, props, children);
    };
  return {
    BottomSheetFooter: component('BottomSheetFooter'),
    BottomSheetScrollView: component('BottomSheetScrollView'),
    BottomSheetTextInput: component('BottomSheetTextInput'),
  };
});

jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const Menu = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu', props, children);

  Menu.Trigger = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Trigger', props, children);
  Menu.Portal = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Portal', props, children);
  Menu.Content = ({
    children,
    footerComponent,
    ...props
  }: {
    children?: React.ReactNode;
    footerComponent?: (props: Record<string, unknown>) => React.ReactNode;
  }) =>
    ReactActual.createElement(
      'Menu.Content',
      props,
      children,
      footerComponent?.({ animatedFooterPosition: 0 })
    );
  Menu.Label = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Label', props, children);
  Menu.Item = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Item', props, children);
  Menu.ItemTitle = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.ItemTitle', props, children);
  Menu.ItemDescription = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.ItemDescription', props, children);

  return { Menu };
});

jest.mock('assets/icons', () => ({
  __esModule: true,
  default: ({ name, ...props }: { name: string }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Icon', { name, ...props });
  },
}));

jest.mock('hex-color-opacity', () => jest.fn((color: string) => color));

function Harness({ successorRendered = false }: { successorRendered?: boolean }) {
  return (
    <>
      <ActionMenuHost />
      {successorRendered ? <E2EActionMenuRenderMarker presentationKey="signer-connect" /> : null}
      <E2EActionMenuProbe />
    </>
  );
}

describe('action-menu successor handoff', () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => {
      renderer?.unmount();
      renderer = undefined;
      dismissActionMenuPopup();
      usePopupStore.getState().close();
      useE2EActionMenuRenderStore.setState({
        renderedSequence: null,
        renderedOpenSeq: null,
        presentedOpenSeq: null,
      });
    });
  });

  it('presents a queued successor only after the native menu finishes closing', async () => {
    act(() => {
      renderer = TestRenderer.create(<Harness />);
      actionMenuPopup({
        title: 'Paste Connection Link',
        primaryAction: {
          text: 'Connect',
          testID: 'paste-connect',
          onPress: (_values, { close }) => {
            close(() => {
              usePopupStore.getState().open({
                sheetId: 'signer-connect',
                payload: { uri: 'nostrconnect://fixture' },
              });
            });
          },
        },
      });
    });

    await act(async () => {
      renderer!.root.findByProps({ testID: 'paste-connect' }).props.onPress();
      await Promise.resolve();
    });

    expect(usePopupStore.getState().isOpen).toBe(false);
    expect(
      renderer!.root.findAllByProps({ testID: 'e2e-action-menu-open:signer-connect' })
    ).toHaveLength(0);

    const content = renderer!.root.find((node) => String(node.type) === 'Menu.Content');
    expect(typeof content.props.onClose).toBe('function');

    act(() => {
      void content.props.onClose();
    });

    expect(usePopupStore.getState()).toMatchObject({
      isOpen: true,
      current: { sheetId: 'signer-connect' },
    });
    expect(
      renderer!.root.findAllByProps({ testID: 'e2e-action-menu-open:signer-connect' })
    ).toHaveLength(0);

    act(() => renderer!.update(<Harness successorRendered />));
    act(() => markE2EActionMenuPresented(usePopupStore.getState().openSeq));

    expect(
      renderer!.root.findByProps({ testID: 'e2e-action-menu-open:signer-connect' })
    ).toBeDefined();
  });
});
