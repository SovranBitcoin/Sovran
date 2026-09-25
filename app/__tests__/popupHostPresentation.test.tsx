/**
 * @jest-environment node
 */

/**
 * PopupHost presents every open() nonce as a FRESH gorhom instance that mounts
 * already open (`mountIndex={0}`, patched heroui prop), so gorhom's own
 * animate-on-mount opens the sheet once its layout is calculated. There is no
 * closed→open flip and no frame-count guess; a watchdog remounts once when
 * gorhom never reports presenting (dead reactions at mount, gorhom #2690) and
 * releases the request on a second stall.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import PopupHost from '@/shared/blocks/popup/PopupHost';
import { OPEN_WATCHDOG_MS } from '@/shared/lib/popup/openWatchdog';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockWarn = jest.fn();
let mockBalanceSats = 10;
jest.mock('@/features/ai/hooks/useRoutstrFunds', () => ({
  useRoutstrFunds: () => ({ balanceSats: mockBalanceSats }),
}));

jest.mock('@/shared/lib/logger', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
  };
  return {
    log: { ...logger, child: () => logger },
    Log: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement(ReactActual.Fragment, null, children),
    storeLog: logger,
    useMountLog: jest.fn(),
    useRenderLogger: jest.fn(),
    redactError: (error: unknown) => error,
  };
});

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: readonly string[]) => tokens.map(String),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { push: jest.fn() } }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => null,
  NostrKeysContextBridge: ({ children }: { children?: React.ReactNode }) => children,
}));
jest.mock('@/shared/lib/popup', () => ({
  registerToast: jest.fn(),
  resolvePopupIcon: () => null,
  isAmountSegment: () => false,
}));
jest.mock('@/shared/lib/popup/E2EToastProbe', () => ({ E2EStaticToastRenderMarker: () => null }));
jest.mock('@/shared/lib/popup/popups/actionMenuSheet', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    ActionMenuSheetContent: () => ReactActual.createElement('ActionMenuSheetContent'),
  };
});
jest.mock('@/shared/lib/popup/popups/emojiPicker', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return { EmojiPickerContent: () => ReactActual.createElement('EmojiPickerContent') };
});
jest.mock('@/shared/lib/popup/popups/modelPicker', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    ModelPickerContent: ({ balanceSats }: { balanceSats: number }) =>
      ReactActual.createElement('View', { testID: 'model-picker-content', balanceSats }),
  };
});
jest.mock('@/shared/lib/popup/popups/nfcTapSheet', () => ({ NfcTapContent: () => null }));
jest.mock('@/shared/lib/popup/popups/paymentOptionsSheet', () => ({
  PaymentOptionsContent: () => null,
}));
jest.mock('@/shared/lib/popup/popups/proofSelectorSheet', () => ({
  ProofSelectorContent: () => null,
}));
jest.mock('@/shared/lib/popup/popups/sendMemoSheet', () => ({ SendMemoContent: () => null }));
jest.mock('@/features/nostrSigner/components/SignerApprovalSheetContent', () => ({
  SignerApprovalSheetContent: () => null,
}));
jest.mock('@/features/nostrSigner/components/SignerConnectSheetContent', () => ({
  SignerConnectSheetContent: () => null,
}));
jest.mock('@/shared/ui/composed/AmountFormatter', () => ({ AmountFormatter: () => null }));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Text', props, children);
  },
}));
// The babel preset rewrites `import { Keyboard } from 'react-native'` to the
// per-export react-native-web path, so mock that path (jsdom-free node env).
jest.mock('react-native-web/dist/exports/Keyboard', () => ({
  __esModule: true,
  default: { dismiss: jest.fn(), addListener: () => ({ remove: () => {} }) },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));
jest.mock('react-native-reanimated', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const component = (name: string) =>
    function MockAnimated({ children, ...props }: { children?: React.ReactNode }) {
      return ReactActual.createElement(name, props, children);
    };
  return {
    __esModule: true,
    default: { View: component('Animated.View'), Text: component('Animated.Text') },
    Easing: { linear: 'linear' },
    SlideInLeft: { duration: () => ({}) },
    SlideInRight: { duration: () => ({}) },
    SlideOutLeft: { duration: () => ({}) },
    SlideOutRight: { duration: () => ({}) },
    cancelAnimation: jest.fn(),
    interpolateColor: () => 'transparent',
    useAnimatedStyle: (worklet: () => object) => worklet(),
    useSharedValue: (initial: unknown) => ReactActual.useRef({ value: initial }).current,
    withTiming: (value: unknown) => value,
  };
});
jest.mock('@gorhom/bottom-sheet', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    BottomSheetFooter: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement('BottomSheetFooter', props, children),
  };
});
jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const BottomSheet = ({ children, ...props }: { children?: React.ReactNode }) => {
    const instance = ReactActual.useRef({});
    return ReactActual.createElement(
      'BottomSheet',
      { ...props, instance: instance.current },
      children
    );
  };
  const element = (name: string) =>
    function MockElement({ children, ...props }: { children?: React.ReactNode }) {
      return ReactActual.createElement(name, props, children);
    };
  BottomSheet.Portal = element('BottomSheet.Portal');
  BottomSheet.Overlay = element('BottomSheet.Overlay');
  BottomSheet.Content = element('BottomSheet.Content');
  BottomSheet.Title = element('BottomSheet.Title');
  BottomSheet.Description = element('BottomSheet.Description');
  BottomSheet.Close = element('BottomSheet.Close');
  const Button = Object.assign(element('Button'), { Label: element('Button.Label') });
  return { BottomSheet, Button, useToast: () => ({ toast: jest.fn() }) };
});

const sheet = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === 'BottomSheet');
const content = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === 'BottomSheet.Content');
const contentGate = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => node.props.testID === 'popup-snap-content-gate');
const bodies = (renderer: TestRenderer.ReactTestRenderer, name: string) =>
  renderer.root.findAll((node) => String(node.type) === name);
const layoutGate = (renderer: TestRenderer.ReactTestRenderer, height: number) =>
  act(() => {
    contentGate(renderer).props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height } },
    });
  });

describe('PopupHost presentation', () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    mockBalanceSats = 10;
    jest.useFakeTimers();
    mockWarn.mockClear();
    usePopupStore.setState({ current: null, isOpen: false, destroyed: false });
  });

  afterEach(() => {
    act(() => {
      renderer?.unmount();
      renderer = undefined;
      usePopupStore.getState().close();
    });
    jest.useRealTimers();
  });

  it('mounts each open() nonce as a fresh instance that is already open at gorhom index 0', () => {
    act(() => {
      renderer = TestRenderer.create(<PopupHost />);
    });
    expect(renderer!.root.findAllByType('BottomSheet' as never)).toHaveLength(0);
    act(() => usePopupStore.getState().open({ message: 'first' }));
    const first = sheet(renderer!).props;
    expect(first.isOpen).toBe(true);
    expect(content(renderer!).props.mountIndex).toBe(0);
    // A second open() while the store already believes a sheet is up (native
    // teardown that bypassed close()) must still present: new nonce, new key.
    act(() => usePopupStore.getState().open({ message: 'second' }));
    expect(sheet(renderer!).props.isOpen).toBe(true);
    expect(sheet(renderer!).props.instance).not.toBe(first.instance);
  });

  it('reuses the closing instance when a follow-on open() lands mid-exit', () => {
    act(() => {
      renderer = TestRenderer.create(<PopupHost />);
      usePopupStore.getState().open({
        sheetId: 'action-menu',
        payload: {
          title: 'Copy token',
          buttons: [{ text: 'as Emoji', testID: 'copy-token-emoji' }],
        },
      });
    });
    const menu = sheet(renderer!).props.instance;
    act(() => usePopupStore.getState().close());
    expect(sheet(renderer!).props.isOpen).toBe(false);
    // The emoji picker dispatches 300ms after the menu's close, inside the
    // 400ms exit window — the same gorhom instance must snap back up.
    act(() => jest.advanceTimersByTime(300));
    act(() =>
      usePopupStore.getState().open({ sheetId: 'emoji-picker', payload: { token: 'cashuB' } })
    );
    expect(sheet(renderer!).props.instance).toBe(menu);
    expect(sheet(renderer!).props.isOpen).toBe(true);
    act(() => jest.advanceTimersByTime(400));
    expect(sheet(renderer!).props.instance).toBe(menu);
    expect(usePopupStore.getState().isOpen).toBe(true);
  });

  it('still mounts a fresh instance for a contentHeight follow-on that lands mid-exit', () => {
    act(() => {
      renderer = TestRenderer.create(<PopupHost />);
      usePopupStore.getState().open({ sheetId: 'emoji-picker', payload: { token: 'cashuB' } });
    });
    const picker = sheet(renderer!).props.instance;
    act(() => usePopupStore.getState().close());
    act(() => jest.advanceTimersByTime(300));
    // contentHeight detents wait on a fresh content measurement, so a reused
    // closing instance could park closed (the dropped-snap case 88eb7f2f fixed).
    act(() =>
      usePopupStore.getState().open({
        sheetId: 'action-menu',
        payload: { title: 'Copy token', buttons: [{ text: 'as Text', testID: 'copy-token-text' }] },
      })
    );
    expect(sheet(renderer!).props.instance).not.toBe(picker);
    expect(sheet(renderer!).props.isOpen).toBe(true);
    expect(content(renderer!).props.mountIndex).toBe(0);
  });

  it('cancels the watchdog once gorhom reports the sheet animating open', () => {
    act(() => {
      renderer = TestRenderer.create(<PopupHost />);
      usePopupStore.getState().open({ message: 'presented' });
    });
    const instance = sheet(renderer!).props.instance;
    act(() => {
      content(renderer!).props.onAnimate(-1, 0, 800, 400);
    });
    act(() => jest.advanceTimersByTime(OPEN_WATCHDOG_MS * 2));
    expect(sheet(renderer!).props.instance).toBe(instance);
    expect(usePopupStore.getState().isOpen).toBe(true);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('remounts a stalled presentation once, then releases the request on a second stall', () => {
    act(() => {
      renderer = TestRenderer.create(<PopupHost />);
      usePopupStore.getState().open({ message: 'stalled' });
    });
    const first = sheet(renderer!).props.instance;
    act(() => jest.advanceTimersByTime(OPEN_WATCHDOG_MS - 1));
    expect(sheet(renderer!).props.instance).toBe(first);
    act(() => jest.advanceTimersByTime(1));
    expect(sheet(renderer!).props.instance).not.toBe(first);
    expect(sheet(renderer!).props.isOpen).toBe(true);
    expect(mockWarn).toHaveBeenCalledWith(
      'popupHost.open_stalled',
      expect.objectContaining({ attempt: 0 })
    );
    act(() => jest.advanceTimersByTime(OPEN_WATCHDOG_MS));
    expect(usePopupStore.getState().isOpen).toBe(false);
    expect(mockWarn).toHaveBeenCalledWith(
      'popupHost.open_stalled',
      expect.objectContaining({ attempt: 1 })
    );
    act(() => jest.advanceTimersByTime(400));
    expect(renderer!.root.findAllByType('BottomSheet' as never)).toHaveLength(0);
  });

  // gorhom's content mask has no height until the container's onLayout lands,
  // and each open() is a fresh instance — a snapPoints body mounted in that
  // first commit lays out unbounded, and the emoji picker's FlashList then
  // renders every row (≈2s JS jam on device, so gorhom never animated open
  // and the watchdog closed the sheet). The body waits for a bounded height.
  it('holds a snapPoints body until its wrapper reports a bounded height', () => {
    act(() => {
      renderer = TestRenderer.create(<PopupHost />);
      usePopupStore.getState().open({ sheetId: 'emoji-picker', payload: { token: 'cashuB' } });
    });
    expect(bodies(renderer!, 'EmojiPickerContent')).toHaveLength(0);
    layoutGate(renderer!, 0);
    expect(bodies(renderer!, 'EmojiPickerContent')).toHaveLength(0);
    layoutGate(renderer!, 640);
    expect(bodies(renderer!, 'EmojiPickerContent')).toHaveLength(1);
    // A later shrink (keyboard) never unmounts a body that is already up.
    layoutGate(renderer!, 320);
    expect(bodies(renderer!, 'EmojiPickerContent')).toHaveLength(1);
  });

  it('mounts a contentHeight body immediately so gorhom can measure it', () => {
    act(() => {
      renderer = TestRenderer.create(<PopupHost />);
      usePopupStore.getState().open({
        sheetId: 'action-menu',
        payload: { title: 'Copy token', buttons: [{ text: 'as Text', testID: 'copy-token-text' }] },
      });
    });
    expect(bodies(renderer!, 'ActionMenuSheetContent')).toHaveLength(1);
    expect(
      renderer!.root.findAll((node) => node.props.testID === 'popup-snap-content-gate')
    ).toHaveLength(0);
  });

  // The model picker renders inside a FullWindowOverlay portal, which sits
  // outside the wallet providers mounted on the route tree — reading the
  // balance from a hook *inside* the body threw "BalanceProvider is missing".
  // The host reads it on the provider side of that boundary and passes it in.
  it('passes live wallet funds across the model-picker portal', () => {
    act(() => {
      renderer = TestRenderer.create(<PopupHost />);
      usePopupStore.getState().open({ sheetId: 'model-picker', payload: {} });
    });
    layoutGate(renderer!, 400);
    const picker = () => renderer!.root.findByProps({ testID: 'model-picker-content' });
    expect(picker().props.balanceSats).toBe(10);

    mockBalanceSats = 25;
    act(() => renderer!.update(<PopupHost />));
    expect(picker().props.balanceSats).toBe(25);
  });

  it('treats a native close reported before layout as a real dismissal', () => {
    act(() => {
      renderer = TestRenderer.create(<PopupHost />);
      usePopupStore.getState().open({ message: 'dismissed early' });
    });
    act(() => {
      sheet(renderer!).props.onOpenChange(false);
    });
    expect(usePopupStore.getState().isOpen).toBe(false);
  });
});
