/**
 * @jest-environment node
 */

/**
 * Changing the model has to leave the picker usable.
 *
 * `ModelPickerContent.handleSelect` writes the slot, raises the
 * "Switched to …" popup and then calls the host's `close()` — three things in
 * one tick, across two stores and the heroui toast manager. This drives the
 * REAL `PopupHost` and the REAL picker body through that sequence and then
 * reopens the picker, which is the step a user reported stops working
 * ("when I change model sometimes it crashes the model selector sheet so I
 * can't change model again").
 *
 * These four cases are the sequences that report is consistent with, and all
 * four are GREEN against the host as it stands — the defect was not
 * reproducible here, so read them as the contract they pin rather than as a
 * repro of a fixed bug: after a selection the picker reopens with pressable
 * rows, and it still does when the re-tap lands inside the 400 ms exit window
 * (the branch that reuses the closing gorhom instance), when a native teardown
 * left `isOpen` stuck true, and when the previous sheet's trailing `close()`
 * arrives after the new one is up. A future change that trades one of those
 * races for another fails here.
 *
 * The device-side counterpart is the logging added alongside these tests:
 * `popupHost.presented`, `popupHost.revive` and `modelPicker.rows`. Together
 * they separate "the sheet never came up" from "it came up with nothing
 * pressable" from "it came up on a revived overlay" — three states the old
 * logs rendered identically as `modelPicker.mount` followed by silence.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import PopupHost from '@/shared/blocks/popup/PopupHost';
import { modelPickerPopup } from '@/shared/lib/popup/popups/modelPicker';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import type { RoutstrModel } from '@/shared/lib/routstr/api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/features/ai/hooks/useRoutstrFunds', () => ({
  useRoutstrFunds: () => ({ mintUrl: 'https://mint.example', balanceSats: 10_164 }),
}));

jest.mock('@/shared/lib/logger', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const entry = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() };
  return {
    log: { ...entry, child: () => entry },
    Log: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement(ReactActual.Fragment, null, children),
    storeLog: entry,
    aiLog: entry,
    apiLog: entry,
    popupLog: entry,
    useMountLog: () => {},
    useRenderLogger: () => {},
    applyFileLogging: jest.fn(),
    redactError: (error: unknown) => error,
  };
});

jest.mock('@/shared/hooks/useThemeColor', () => {
  const { INVARIANT_BLACK } = jest.requireActual<typeof import('@/shared/lib/brandColors')>(
    '@/shared/lib/brandColors'
  );
  return {
    useThemeColor: (tokens: string | readonly string[]) =>
      Array.isArray(tokens) ? tokens.map(() => INVARIANT_BLACK) : INVARIANT_BLACK,
  };
});
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { push: jest.fn(), navigate: jest.fn() },
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => null,
  NostrKeysContextBridge: ({ children }: { children?: React.ReactNode }) => children,
}));

// Routstr store side deps — persistence and the network client belong to other
// tests; this one needs the store's in-memory behaviour only.
jest.mock('@/shared/lib/apiClient', () => ({ getAiLineup: jest.fn() }));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({ activeAccountIndex: 0, profiles: [{ accountIndex: 0 }] }),
  },
}));
jest.mock('@/shared/lib/routstr/api', () => ({
  setRoutstrNodeBaseUrl: jest.fn(),
  ROUTSTR_MAX_COMPLETION_TOKENS: 4096,
}));
jest.mock('@/shared/lib/routstr/securePersistence', () => ({
  createRoutstrPersistence: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/routstr/secureVault', () => ({
  createSecureVault: () => ({ read: async () => null, write: async () => {} }),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  captureProfileStorageOwner: async () => 'a'.repeat(64),
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/http/requestSignal', () => ({ buildAbortSignal: () => undefined }));

jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/shared/lib/popup/E2EToastProbe', () => ({ E2EStaticToastRenderMarker: () => null }));
jest.mock('@/shared/lib/popup/E2EActionMenuProbe', () => ({
  E2EActionMenuRenderMarker: () => null,
  markE2EActionMenuPresented: jest.fn(),
}));
jest.mock('@/shared/lib/popup/CompactToast', () => ({ CompactToast: () => null }));

// Sheet bodies this test never opens.
jest.mock('@/shared/lib/popup/popups/actionMenuSheet', () => ({
  ActionMenuSheetContent: () => null,
}));
jest.mock('@/shared/lib/popup/popups/emojiPicker', () => ({ EmojiPickerContent: () => null }));
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
  SignerProfilePickerContent: () => null,
}));
jest.mock('@/shared/ui/composed/AmountFormatter', () => ({ AmountFormatter: () => null }));

const passthrough = (name: string) =>
  function Passthrough({ children, ...props }: { children?: React.ReactNode }) {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement(name, props, children);
  };

jest.mock('@/shared/ui/primitives/Text', () => ({ Text: passthrough('Text') }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: passthrough('Pressable') }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: passthrough('HStack') }));

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
    default: {
      View: component('Animated.View'),
      Text: component('Animated.Text'),
      createAnimatedComponent: (inner: unknown) => component(String(inner)),
    },
    Easing: {
      linear: 'linear',
      ease: 'ease',
      bezier: () => 'bezier',
      inOut: () => 'inOut',
      in: () => 'in',
      out: () => 'out',
      cubic: 'cubic',
    },
    Extrapolation: { CLAMP: 'clamp' },
    interpolate: () => 0,
    runOnJS: (fn: unknown) => fn,
    useDerivedValue: (worklet: () => unknown) => ({ value: worklet(), get: worklet }),
    withDelay: (_ms: number, value: unknown) => value,
    withRepeat: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    withSpring: (value: unknown) => value,
    SlideInLeft: { duration: () => ({}) },
    SlideInRight: { duration: () => ({}) },
    SlideOutLeft: { duration: () => ({}) },
    SlideOutRight: { duration: () => ({}) },
    cancelAnimation: jest.fn(),
    createAnimatedComponent: (inner: unknown) => component(String(inner)),
    interpolateColor: () => 'transparent',
    useAnimatedStyle: (worklet: () => object) => worklet(),
    useSharedValue: (initial: unknown) => {
      const ref = ReactActual.useRef({
        value: initial,
        get: () => initial,
        set: () => {},
      });
      return ref.current;
    },
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

/** heroui stand-in: enough of `BottomSheet` / `Menu` / `useToast` to render. */
jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const element = (name: string) =>
    function MockElement({ children, ...props }: { children?: React.ReactNode }) {
      return ReactActual.createElement(name, props, children);
    };
  const BottomSheet = ({ children, ...props }: { children?: React.ReactNode }) => {
    const instance = ReactActual.useRef({});
    return ReactActual.createElement(
      'BottomSheet',
      { ...props, instance: instance.current },
      children
    );
  };
  BottomSheet.Portal = element('BottomSheet.Portal');
  BottomSheet.Overlay = element('BottomSheet.Overlay');
  BottomSheet.Content = element('BottomSheet.Content');
  BottomSheet.Title = element('BottomSheet.Title');
  BottomSheet.Description = element('BottomSheet.Description');
  BottomSheet.Close = element('BottomSheet.Close');
  const Menu = Object.assign(element('Menu'), {
    Item: element('MenuItem'),
    ItemTitle: element('MenuItemTitle'),
    ItemDescription: element('MenuItemDescription'),
  });
  const Button = Object.assign(element('Button'), { Label: element('Button.Label') });
  return {
    BottomSheet,
    Button,
    Menu,
    useToast: () => ({ toast: { show: () => 'toast-1', hide: () => {} } }),
  };
});

/** A catalog row the lineup accepts; `rate` orders the tier ladder. */
const usable = (id: string, name: string, rate: number): RoutstrModel =>
  ({
    id,
    name,
    canonical_slug: `openai/${id}`,
    enabled: true,
    context_length: 128_000,
    created: 1_780_000_000,
    architecture: { output_modalities: ['text'], input_modalities: ['text'] },
    sats_pricing: { prompt: rate, completion: rate * 4, request: 0, image: 0, max_cost: 40 },
  }) as unknown as RoutstrModel;

const CATALOG = [
  usable('gpt-5-mini', 'OpenAI: GPT-5 mini', 0.00001),
  usable('gpt-5', 'OpenAI: GPT-5', 0.0001),
  usable('gpt-5-pro', 'OpenAI: GPT-5 Pro', 0.001),
];

const contentGate = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll((node) => node.props.testID === 'popup-snap-content-gate');

/** Give the snapPoints gate a bounded height so the picker body mounts. */
const layoutGate = (renderer: TestRenderer.ReactTestRenderer) =>
  act(() => {
    for (const gate of contentGate(renderer)) {
      gate.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 420 } } });
    }
  });

/** Every tier row currently on screen, by testID. */
const tierRows = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll((node) =>
    String(node.props.testID ?? '').match(/^ai-model-openai-(auto|pro|max)$/) ? true : false
  );

/** Rows the user can actually press: mounted and not `isDisabled`. */
const pressableRows = (renderer: TestRenderer.ReactTestRenderer) =>
  tierRows(renderer).filter((row) => row.props.isDisabled !== true);

describe('changing the model leaves the picker usable', () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    usePopupStore.setState({ current: null, isOpen: false, destroyed: false, openSeq: 0 });
    useRoutstrStore.setState({
      lineup: null,
      lastKnownLineup: null,
      modelsCache: null,
      serverLineupAt: null,
      selectedProvider: 'openai',
      selectedTier: 'auto',
    });
    useRoutstrStore.getState().setCachedModels(CATALOG);
  });

  afterEach(() => {
    act(() => {
      renderer?.unmount();
      renderer = undefined;
      usePopupStore.getState().close();
    });
    jest.useRealTimers();
  });

  /** Open the picker exactly the way the chip does and settle its dispatch. */
  const openPicker = () => {
    act(() => {
      modelPickerPopup();
      jest.advanceTimersByTime(1);
    });
    layoutGate(renderer!);
  };

  it('reopens with working rows after a selection', () => {
    act(() => {
      renderer = TestRenderer.create(<PopupHost />);
    });

    openPicker();
    expect(pressableRows(renderer!).length).toBeGreaterThan(0);

    // Pick the Pro tier: setSelectedSlot → paramPopup('model-switched') → close().
    const pro = renderer!.root.findByProps({ testID: 'ai-model-openai-pro' });
    act(() => {
      pro.props.onPress();
    });
    expect(useRoutstrStore.getState().selectedTier).toBe('pro');
    expect(usePopupStore.getState().isOpen).toBe(false);

    // Let the exit window (400ms) and the toast settle, then change model again.
    act(() => jest.advanceTimersByTime(1000));
    openPicker();

    expect(usePopupStore.getState().isOpen).toBe(true);
    expect(pressableRows(renderer!).length).toBeGreaterThan(0);
  });

  it('reopens with working rows when the user taps again inside the exit window', () => {
    act(() => {
      renderer = TestRenderer.create(<PopupHost />);
    });

    openPicker();
    const pro = renderer!.root.findByProps({ testID: 'ai-model-openai-pro' });
    act(() => {
      pro.props.onPress();
    });

    // The impatient re-tap: inside PopupHost's 400ms exit window, which is the
    // branch that reuses the closing gorhom instance instead of mounting a
    // fresh one.
    act(() => jest.advanceTimersByTime(120));
    openPicker();

    expect(usePopupStore.getState().isOpen).toBe(true);
    expect(tierRows(renderer!).length).toBeGreaterThan(0);
    expect(pressableRows(renderer!).length).toBeGreaterThan(0);
  });

  // The "dead Next" shape: a native teardown (route navigation ripping the
  // FullWindowOverlay) never reaches store.close(), so `isOpen` is stuck true
  // when the chip asks for the picker again. `openSeq` is what rescues it.
  it('reopens after a native teardown left the store believing it was open', () => {
    act(() => {
      renderer = TestRenderer.create(<PopupHost />);
    });

    openPicker();
    const stranded = renderer!.root.find((n) => String(n.type) === 'BottomSheet').props.instance;

    openPicker();

    expect(usePopupStore.getState().isOpen).toBe(true);
    expect(renderer!.root.find((n) => String(n.type) === 'BottomSheet').props.instance).not.toBe(
      stranded
    );
    expect(pressableRows(renderer!).length).toBeGreaterThan(0);
  });

  // The picker's own `close()` carries the seq it was presented under, so the
  // trailing close of the sheet the user just left can never tear down the one
  // they just opened.
  it('ignores the outgoing sheet late close after the picker has reopened', () => {
    act(() => {
      renderer = TestRenderer.create(<PopupHost />);
    });

    openPicker();
    const staleSeq = usePopupStore.getState().openSeq;
    const pro = renderer!.root.findByProps({ testID: 'ai-model-openai-pro' });
    act(() => {
      pro.props.onPress();
    });
    act(() => jest.advanceTimersByTime(600));

    openPicker();
    act(() => usePopupStore.getState().close(staleSeq));

    expect(usePopupStore.getState().isOpen).toBe(true);
    expect(pressableRows(renderer!).length).toBeGreaterThan(0);
  });
});
