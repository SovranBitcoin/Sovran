/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { MenuScrim } from '@/shared/blocks/popup/MenuScrim';
import { ActionMenuHost } from '@/shared/blocks/popup/ActionMenuHost';
import {
  E2EActionMenuProbe,
  E2EActionMenuRenderMarker,
  markE2EActionMenuPresented,
  useE2EActionMenuRenderStore,
} from '@/shared/lib/popup/E2EActionMenuProbe';
import {
  actionMenuPopup,
  dismissActionMenuPopup,
  getActionMenuSnapshot,
  replaceActionMenuPopup,
} from '@/shared/lib/popup/popups/actionMenu';
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
    useMountLog: jest.fn(),
    useRenderLogger: jest.fn(),
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

const mockMenuAnimation = { progress: { value: 0 }, isDragging: { value: false } };
let mockMenuOpen = true;
let mockTweenFraction = 1;

jest.mock('@/shared/hooks/useColorScheme', () => ({ useColorScheme: () => 'dark' }));
jest.mock('react-native-reanimated', () => ({
  useSharedValue: (initial: number) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.useRef({ value: initial }).current;
  },
  useAnimatedStyle: (worklet: () => object) => worklet(),
  withTiming: (value: number) => value * mockTweenFraction,
  interpolate: jest.requireActual('react-native-reanimated').interpolate,
  Extrapolation: { CLAMP: 'clamp' },
}));

jest.mock('@/shared/ui/composed/ScrollEdgeFade', () => ({ ScrollEdgeFade: () => null }));
jest.mock('@shopify/flash-list', () => ({
  FlashList: (props: object) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('FlashList', props);
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
  const Menu = ({ children, ...props }: { children?: React.ReactNode }) => {
    const instance = ReactActual.useRef({});
    return ReactActual.createElement('Menu', { ...props, instance: instance.current }, children);
  };

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

  Menu.Overlay = ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Menu.Overlay', props, children);
  return {
    Menu,
    useMenu: () => ({ isOpen: mockMenuOpen }),
    useMenuAnimation: () => mockMenuAnimation,
  };
});

jest.mock('assets/icons', () => ({
  __esModule: true,
  default: ({ name, ...props }: { name: string }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Icon', { name, ...props });
  },
}));

jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: jest.fn((color: string) => color),
}));

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
      jest.useRealTimers();
      dismissActionMenuPopup();
      usePopupStore.getState().close();
      useE2EActionMenuRenderStore.setState({
        renderedSequence: null,
        renderedOpenSeq: null,
        presentedOpenSeq: null,
      });
    });
  });

  it('caps the scrim tween at sheet visibility and holds visibility while dragging', () => {
    const opacity = () =>
      renderer!.root.find((node) => String(node.type) === 'Menu.Overlay').props.style.opacity;
    mockMenuOpen = true;
    mockTweenFraction = 0.4;
    mockMenuAnimation.progress.value = 0;
    act(() => {
      renderer = TestRenderer.create(<MenuScrim />);
    });
    act(() => renderer!.update(<MenuScrim />));
    expect(opacity()).toBe(0);
    mockMenuAnimation.progress.value = 1;
    act(() => renderer!.update(<MenuScrim />));
    expect(opacity()).toBe(0.4);
    mockMenuAnimation.progress.value = 2;
    act(() => renderer!.update(<MenuScrim />));
    expect(opacity()).toBe(0);
    mockMenuAnimation.isDragging.value = true;
    act(() => renderer!.update(<MenuScrim />));
    expect(opacity()).toBe(0.4);
    mockMenuOpen = false;
    act(() => renderer!.update(<MenuScrim />));
    act(() => renderer!.update(<MenuScrim />));
    expect(opacity()).toBe(0);
    mockMenuAnimation.isDragging.value = false;
    mockMenuOpen = true;
    mockTweenFraction = 1;
  });

  it('updates list extent through a footer spacer and removes single-section anchor chrome', () => {
    const { SectionAnchorList } = jest.requireActual<
      typeof import('@/shared/ui/composed/SectionAnchorList')
    >('@/shared/ui/composed/SectionAnchorList');
    const sections = [
      { id: 'one', anchor: { label: 'One', testID: 'anchor-one' }, data: ['first'] },
      { id: 'two', anchor: { label: 'Two', testID: 'anchor-two' }, data: ['last'] },
    ];
    const content = (single: boolean, inset: number) => (
      <SectionAnchorList
        sections={single ? sections.slice(0, 1) : sections}
        renderItem={(item) => item}
        keyExtractor={(item) => item}
        contentBottomInset={inset}
      />
    );
    act(() => {
      renderer = TestRenderer.create(content(false, 32));
    });
    const bar = renderer!.root.find(
      (node) => String(node.type) === 'View' && typeof node.props.onLayout === 'function'
    );
    act(() => {
      bar.props.onLayout({ nativeEvent: { layout: { height: 40 } } });
    });
    const list = () => renderer!.root.find((node) => String(node.type) === 'FlashList');
    expect(list().props.contentContainerStyle.paddingTop).toBe(52);
    act(() => renderer!.update(content(true, 144)));
    expect(renderer!.root.findAllByProps({ testID: 'anchor-one' })).toHaveLength(0);
    expect(list().props.contentContainerStyle.paddingTop).toBe(12);
    expect(list().props.contentContainerStyle.paddingBottom).toBeUndefined();
    expect(list().props.ListFooterComponent.props.style.height).toBe(144);
    expect(list().props.extraData.contentBottomInset).toBe(144);
  });

  it('reserves a measured section footer once and keeps its remaining gap in the list spacer', () => {
    act(() => {
      renderer = TestRenderer.create(<ActionMenuHost />);
      actionMenuPopup({
        sections: [{ id: 'profiles', anchor: { label: 'Profiles' }, buttons: [] }],
        footerButtons: [{ text: 'Create', testID: 'create' }],
      });
    });
    const sectionList = () =>
      renderer!.root.find((node) => String(node.type) === 'SectionAnchorList');
    expect(sectionList().props.contentBottomInset).toBe(112);
    act(() => {
      renderer!.root
        .find((node) => String(node.type) === 'BottomButtons')
        .props.onLayout({
          nativeEvent: { layout: { height: 128 } },
        });
    });
    const content = renderer!.root.find((node) => String(node.type) === 'Menu.Content');
    expect(content.props.contentContainerClassName).toBe('flex-1 px-0 pt-0 pb-0');
    expect(content.props.contentContainerProps.style.paddingBottom).toBe(128);
    expect(sectionList().props.contentBottomInset).toBe(16);
  });

  it('keeps the second menu visible when the first instance closes late', () => {
    act(() => {
      renderer = TestRenderer.create(<Harness />);
      actionMenuPopup({ title: 'First menu' });
    });
    const firstClose = renderer!.root.find((node) => String(node.type) === 'Menu.Content').props
      .onClose;
    const second = { title: 'Second menu' };
    act(() => actionMenuPopup(second));
    act(() => {
      firstClose();
    });
    expect(renderer!.root.find((node) => String(node.type) === 'Menu.Label').props.children).toBe(
      'Second menu'
    );
    expect(getActionMenuSnapshot().payload).toBe(second);
  });

  it('clears an orphaned current request and calls onDismiss once on native close', () => {
    const onDismiss = jest.fn();
    act(() => {
      renderer = TestRenderer.create(<ActionMenuHost />);
      actionMenuPopup({ title: 'Current', onDismiss });
    });
    const onClose = renderer!.root.find((node) => String(node.type) === 'Menu.Content').props
      .onClose;
    act(() => {
      onClose();
    });
    act(() => {
      onClose();
    });
    expect(getActionMenuSnapshot().payload).toBeNull();
    expect(renderer!.toJSON()).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('reopens during closing with a fresh native instance and reset inputs', () => {
    const menu = { title: 'Input', inputs: [{ id: 'name', initialValue: 'Initial' }] };
    act(() => {
      renderer = TestRenderer.create(<ActionMenuHost />);
      actionMenuPopup(menu);
    });
    const firstInstance = renderer!.root.find((node) => String(node.type) === 'Menu').props
      .instance;
    const firstSeq = getActionMenuSnapshot().seq;
    act(() => {
      renderer!.root.findByProps({ testID: 'action-menu-input-name' }).props.onChangeText('Edited');
    });
    act(() => dismissActionMenuPopup());
    expect(renderer!.root.find((node) => String(node.type) === 'Menu').props.isOpen).toBe(false);
    act(() => actionMenuPopup(menu));
    expect(getActionMenuSnapshot().seq).toBe(firstSeq + 1);
    expect(renderer!.root.find((node) => String(node.type) === 'Menu').props.instance).not.toBe(
      firstInstance
    );
    expect(renderer!.root.findByProps({ testID: 'action-menu-input-name' }).props.value).toBe(
      'Initial'
    );
  });

  it('runs an item successor once and only after native close', () => {
    const next = jest.fn(() => actionMenuPopup({ title: 'Successor' }));
    act(() => {
      renderer = TestRenderer.create(<ActionMenuHost />);
      actionMenuPopup({
        buttons: [{ text: 'Next', testID: 'next', onPress: (close) => close(next) }],
      });
    });
    const onClose = renderer!.root.find((node) => String(node.type) === 'Menu.Content').props
      .onClose;
    const press = renderer!.root.findByProps({ testID: 'next' }).props.onPress;
    act(() => {
      press();
      press();
    });
    expect(next).not.toHaveBeenCalled();
    act(() => {
      onClose();
    });
    act(() => {
      onClose();
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(getActionMenuSnapshot().payload?.title).toBe('Successor');
    expect(renderer!.root.find((node) => String(node.type) === 'Menu.Label').props.children).toBe(
      'Successor'
    );
  });

  it('replaces keepOpen content without remounting or accepting the item auto-close', () => {
    act(() => {
      renderer = TestRenderer.create(<ActionMenuHost />);
      actionMenuPopup({
        buttons: [
          {
            text: 'Replace',
            testID: 'replace',
            keepOpen: true,
            onPress: () => replaceActionMenuPopup({ title: 'Confirmation' }),
          },
        ],
      });
    });
    const before = renderer!.root.find((node) => String(node.type) === 'Menu').props;
    const seq = getActionMenuSnapshot().seq;
    act(() => {
      renderer!.root.findByProps({ testID: 'replace' }).props.onPress();
      before.onOpenChange(false);
    });
    expect(getActionMenuSnapshot().seq).toBe(seq);
    expect(getActionMenuSnapshot().payload?.title).toBe('Confirmation');
    expect(renderer!.root.find((node) => String(node.type) === 'Menu').props.instance).toBe(
      before.instance
    );
  });

  it('remounts a stalled presentation once, ignores that attempt closing, then clears a second stall', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    act(() => {
      renderer = TestRenderer.create(<ActionMenuHost />);
      actionMenuPopup({ title: 'Stalled', onDismiss });
    });
    const first = renderer!.root.find((node) => String(node.type) === 'Menu').props;
    const firstClose = renderer!.root.find((node) => String(node.type) === 'Menu.Content').props
      .onClose;
    act(() => jest.advanceTimersByTime(799));
    expect(renderer!.root.find((node) => String(node.type) === 'Menu').props.instance).toBe(
      first.instance
    );
    act(() => jest.advanceTimersByTime(1));
    expect(renderer!.root.find((node) => String(node.type) === 'Menu').props.instance).not.toBe(
      first.instance
    );
    act(() => {
      firstClose();
      first.onOpenChange(false);
    });
    expect(getActionMenuSnapshot().payload?.title).toBe('Stalled');
    act(() => jest.advanceTimersByTime(800));
    expect(renderer!.toJSON()).toBeNull();
    expect(getActionMenuSnapshot().payload).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('cancels the watchdog when gorhom starts presenting the sheet', () => {
    jest.useFakeTimers();
    act(() => {
      renderer = TestRenderer.create(<ActionMenuHost />);
      actionMenuPopup({ title: 'Presented' });
    });
    const instance = renderer!.root.find((node) => String(node.type) === 'Menu').props.instance;
    expect(renderer!.root.findAllByProps({ testID: 'action-menu-presented' })).toHaveLength(0);
    act(() => {
      renderer!.root
        .find((node) => String(node.type) === 'Menu.Content')
        .props.onAnimate(-1, 0, 800, 400);
    });
    act(() => jest.advanceTimersByTime(1600));
    expect(renderer!.root.find((node) => String(node.type) === 'Menu').props.instance).toBe(
      instance
    );
    expect(getActionMenuSnapshot().payload?.title).toBe('Presented');
    expect(
      renderer!.root.findAllByProps({ testID: 'action-menu-presented' }).length
    ).toBeGreaterThan(0);
    act(() => dismissActionMenuPopup());
    expect(renderer!.root.findAllByProps({ testID: 'action-menu-presented' })).toHaveLength(0);
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
