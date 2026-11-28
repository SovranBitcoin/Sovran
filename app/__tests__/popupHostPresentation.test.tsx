/**
 * @jest-environment node
 */

/**
 * PopupHost draws the popup lane's sheet on the house `Sheet`. At rest
 * nothing is mounted; each open() nonce (openSeq) mounts a fresh sheet whose
 * content is there from the first render and which slides up once laid out; a
 * follow-on open() replaces it, and a stale close from the sheet it replaced
 * cannot take the new one down. The sheet stays drawn through its exit and
 * unmounts once it reports `onClosed`.
 *
 * The real Sheet renders here over stand-ins for its native runtime
 * (helpers/sheetRuntimeMocks); `finishAnimations()` lands its slide.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import PopupHost from '@/shared/blocks/popup/PopupHost';
import { markE2EActionMenuPresented } from '@/shared/lib/popup/E2EActionMenuProbe';
import { Sheet } from '@/shared/ui/composed/Sheet';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import {
  finishAnimations,
  finishOldestAnimation,
  resetAnimations,
} from './helpers/sheetRuntimeMocks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-reanimated', () => require('./helpers/sheetRuntimeMocks').reanimated);
jest.mock(
  'react-native-gesture-handler',
  () => require('./helpers/sheetRuntimeMocks').gestureHandler
);
jest.mock(
  'react-native-keyboard-controller',
  () => require('./helpers/sheetRuntimeMocks').keyboardController
);
jest.mock('react-native-screens', () => require('./helpers/sheetRuntimeMocks').screens);
jest.mock('react-native-worklets', () => require('./helpers/sheetRuntimeMocks').worklets);
jest.mock('react-native-safe-area-context', () => require('./helpers/sheetRuntimeMocks').safeArea);
jest.mock(
  'react-native-web/dist/exports/useWindowDimensions',
  () => require('./helpers/sheetRuntimeMocks').windowDimensions
);
// The babel preset rewrites `import { Keyboard } from 'react-native'` to the
// per-export react-native-web path, so mock that path (jsdom-free node env).
jest.mock('react-native-web/dist/exports/Keyboard', () => ({
  __esModule: true,
  default: { dismiss: jest.fn(), addListener: () => ({ remove: () => {} }) },
}));

jest.mock('@/shared/lib/logger', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() };
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
  // eslint-disable-next-line no-restricted-syntax -- fixture theme colours must parse as hex
  useThemeColor: (tokens: readonly string[]) => tokens.map(() => '#808080'),
}));
jest.mock('@/shared/hooks/useColorScheme', () => ({ useColorScheme: () => 'dark' }));
jest.mock('@/shared/lib/popup', () => ({
  resolvePopupIcon: () => null,
  isAmountSegment: () => false,
}));
jest.mock('@/shared/lib/popup/E2EToastProbe', () => ({ E2EStaticToastRenderMarker: () => null }));
jest.mock('@/shared/lib/popup/E2EActionMenuProbe', () => ({
  markE2EActionMenuPresented: jest.fn(),
}));
const mockCustomSheetProps = jest.fn();
jest.mock('@/shared/lib/popup/popups/actionMenuSheet', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    ActionMenuSheetContent: (props: Record<string, unknown>) => {
      mockCustomSheetProps(props);
      return ReactActual.createElement('ActionMenuSheetContent', props);
    },
  };
});
jest.mock('@/shared/lib/popup/popups/nfcTapSheet', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    NfcTapContent: ({
      setFooterConfig,
      close,
    }: {
      setFooterConfig: (cfg: {
        buttons: { text: string; testID: string; onPress: () => void }[];
      }) => void;
      close: () => void;
    }) => {
      ReactActual.useEffect(() => {
        setFooterConfig({ buttons: [{ text: 'Close', testID: 'nfc-close', onPress: close }] });
      }, [setFooterConfig, close]);
      return ReactActual.createElement('NfcTapContent');
    },
  };
});
jest.mock('@/shared/lib/popup/popups/sendMemoSheet', () => ({ SendMemoContent: () => null }));
jest.mock('@/shared/ui/composed/ToastHost', () => ({ ToastHost: () => null }));
jest.mock('@/shared/ui/composed/TouchIndicator', () => ({
  TouchIndicatorLayer: ({ children }: { children?: React.ReactNode }) => children,
}));
jest.mock('@/shared/ui/composed/AmountFormatter', () => ({ AmountFormatter: () => null }));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: ({ children, ...props }: { children?: React.ReactNode }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return ReactActual.createElement('Text', props, children);
  },
}));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: 'Button' }));

let renderer: TestRenderer.ReactTestRenderer | undefined;

function mountHost() {
  act(() => {
    renderer = TestRenderer.create(<PopupHost />);
  });
  return renderer!;
}

const sheets = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(Sheet);
const sheet = (r: TestRenderer.ReactTestRenderer) => r.root.findByType(Sheet);
/** The sheet surface: the view that measures itself to slide up. */
const panel = (r: TestRenderer.ReactTestRenderer) =>
  sheet(r).findAll((node) => typeof node.props.onLayout === 'function' && node.props.className)[0]!;
/** The scrim's pressable (the composite that owns `onPress`). */
const scrim = (r: TestRenderer.ReactTestRenderer) =>
  r.root.findAll(
    (node) => node.props.testID === 'popup-sheet-overlay' && 'accessibilityState' in node.props
  )[0]!;
/** Strings drawn inside the sheet surface. */
const shownText = (r: TestRenderer.ReactTestRenderer) =>
  panel(r)
    .findAll((node) => typeof node.type === 'string')
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'));

function layOut(r: TestRenderer.ReactTestRenderer, height = 300) {
  act(() => {
    panel(r).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } });
  });
}

/** Where the surface is drawn: 0 when fully up, the window height before it is measured. */
function offset(r: TestRenderer.ReactTestRenderer): number {
  const style = ([] as unknown[]).concat(panel(r).props.style).flat(Infinity) as {
    transform?: { translateY?: number }[];
  }[];
  return style.reduce(
    (value, entry) => entry?.transform?.find((step) => 'translateY' in step)?.translateY ?? value,
    Number.NaN
  );
}

const WINDOW_HEIGHT = 844;

describe('PopupHost presentation', () => {
  beforeEach(() => {
    mockCustomSheetProps.mockClear();
    jest.mocked(markE2EActionMenuPresented).mockClear();
    usePopupStore.setState({ current: null, isOpen: false, destroyed: false });
  });

  afterEach(() => {
    act(() => {
      renderer?.unmount();
      renderer = undefined;
      usePopupStore.getState().close();
    });
    resetAnimations();
  });

  it('mounts nothing at rest and the sheet with its content on open, before any layout', () => {
    const r = mountHost();
    expect(sheets(r)).toHaveLength(0);
    act(() => usePopupStore.getState().open({ message: 'Payment sent' }));
    expect(sheets(r)).toHaveLength(1);
    expect(sheet(r).props.open).toBe(true);
    // No delayed mount gate: the body is there while the sheet waits to be measured.
    expect(offset(r)).toBe(WINDOW_HEIGHT);
    expect(shownText(r)).toContain('Payment sent');
  });

  it('mounts a custom sheet body immediately, handing it only payload, close and setFooterConfig', () => {
    const r = mountHost();
    const payload = { title: 'Copy token', buttons: [] };
    act(() => usePopupStore.getState().open({ sheetId: 'action-menu', payload }));
    expect(r.root.findAll((node) => String(node.type) === 'ActionMenuSheetContent')).toHaveLength(
      1
    );
    const props = mockCustomSheetProps.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['close', 'payload', 'setFooterConfig']);
    expect(props.payload).toBe(payload);
  });

  it('keeps the sheet out of the accessibility tree so its controls stay reachable', () => {
    const r = mountHost();
    act(() => usePopupStore.getState().open({ message: 'reachable' }));
    expect(panel(r).props.accessible).toBe(false);
    expect(shownText(r)).toContain('reachable');
  });

  it('slides the sheet up once laid out and marks an action menu presented only when it lands', () => {
    const r = mountHost();
    act(() =>
      usePopupStore
        .getState()
        .open({ sheetId: 'action-menu', payload: { title: 'Pick', buttons: [] } })
    );
    const seq = usePopupStore.getState().openSeq;
    layOut(r);
    expect(offset(r)).toBe(0);
    expect(markE2EActionMenuPresented).not.toHaveBeenCalled();
    act(() => finishAnimations());
    expect(markE2EActionMenuPresented).toHaveBeenCalledWith(seq);
  });

  it('mounts each open() nonce as a fresh sheet that slides up again', () => {
    const r = mountHost();
    act(() => usePopupStore.getState().open({ message: 'first' }));
    layOut(r);
    act(() => finishAnimations());
    expect(offset(r)).toBe(0);
    // A second open() while the store still believes a sheet is up must present
    // anew: a new instance, unmeasured, waiting below the window.
    act(() => usePopupStore.getState().open({ message: 'second' }));
    expect(sheets(r)).toHaveLength(1);
    expect(sheet(r).props.open).toBe(true);
    expect(offset(r)).toBe(WINDOW_HEIGHT);
    expect(shownText(r)).toEqual(['second']);
  });

  it("replaces the sheet with a follow-on open, and the first sheet's trailing close does not close it", async () => {
    const r = mountHost();
    // Popups reach the store through the bridge's sheet config, which carries testIDs.
    const openFee = {
      text: 'Network fee',
      testID: 'open-fee',
      onPress: () => usePopupStore.getState().open({ message: 'Network fee' }),
    };
    act(() => usePopupStore.getState().open({ message: 'Choose amount', buttons: [openFee] }));
    const chooserSeq = usePopupStore.getState().openSeq;
    // The button opens the next sheet, then runs its own close() for the chooser.
    const button = r.root.findAll(
      (node) => node.props.testID === 'open-fee' && typeof node.props.onPress === 'function'
    )[0]!;
    await act(async () => {
      await button.props.onPress();
    });
    expect(usePopupStore.getState()).toMatchObject({ isOpen: true, openSeq: chooserSeq + 1 });
    expect(sheets(r)).toHaveLength(1);
    expect(sheet(r).props.open).toBe(true);
    expect(shownText(r)).toEqual(['Network fee']);
  });

  it('closes the sheet as soon as a button is pressed, while its action is still running', async () => {
    const r = mountHost();
    let finish!: () => void;
    const running = new Promise<void>((done) => (finish = done));
    const onPress = jest.fn(() => running);
    act(() =>
      usePopupStore.getState().open({
        message: 'Redeem',
        buttons: [{ text: 'Redeem', testID: 'slow-action', onPress }],
      })
    );
    const button = r.root.findAll(
      (node) => node.props.testID === 'slow-action' && typeof node.props.onPress === 'function'
    )[0]!;
    let pressed!: Promise<unknown>;
    act(() => {
      pressed = button.props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(usePopupStore.getState().isOpen).toBe(false);
    await act(async () => {
      finish();
      await pressed;
    });
    expect(usePopupStore.getState().isOpen).toBe(false);
  });

  it('dismisses from the scrim, and ignores it when the sheet is not dismissable', () => {
    const onClose = jest.fn();
    const r = mountHost();
    act(() => usePopupStore.getState().open({ message: 'Hold on', dismissable: false, onClose }));
    expect(scrim(r).props.onPress).toBeUndefined();
    expect(scrim(r).props.accessibilityState).toEqual({ disabled: true });
    expect(usePopupStore.getState().isOpen).toBe(true);

    act(() => usePopupStore.getState().open({ message: 'Done', onClose }));
    onClose.mockClear();
    // Dismissed before it was ever laid out: still a real dismissal.
    act(() => {
      scrim(r).props.onPress();
    });
    expect(usePopupStore.getState().isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledWith({ reason: 'dismiss' });
  });

  it('keeps the sheet drawn while it slides away, and unmounts it once it has closed', () => {
    const r = mountHost();
    act(() => usePopupStore.getState().open({ message: 'Leaving' }));
    layOut(r);
    act(() => finishAnimations());
    act(() => usePopupStore.getState().close());
    expect(sheet(r).props.open).toBe(false);
    expect(shownText(r)).toContain('Leaving');
    act(() => finishAnimations());
    expect(sheets(r)).toHaveLength(0);
  });

  it('a stale close from the sheet that was replaced mid-exit leaves the new one up', () => {
    const r = mountHost();
    act(() => usePopupStore.getState().open({ message: 'first' }));
    layOut(r);
    act(() => usePopupStore.getState().close());
    // The first sheet's exit has not landed when the next one opens.
    act(() => usePopupStore.getState().open({ message: 'second' }));
    act(() => finishAnimations());
    expect(sheets(r)).toHaveLength(1);
    expect(sheet(r).props.open).toBe(true);
    expect(shownText(r)).toEqual(['second']);
  });

  it("a replaced sheet's late exit does not cut short the exit of the sheet after it", () => {
    const r = mountHost();
    act(() => usePopupStore.getState().open({ message: 'first' }));
    layOut(r);
    act(() => finishAnimations());
    act(() => usePopupStore.getState().close());
    act(() => usePopupStore.getState().open({ message: 'second' }));
    act(() => usePopupStore.getState().close());
    // The first sheet's exit lands while the second is still sliding away.
    act(() => finishOldestAnimation());
    expect(sheets(r)).toHaveLength(1);
    expect(sheet(r).props.open).toBe(false);
    expect(shownText(r)).toEqual(['second']);
    act(() => finishAnimations());
    expect(sheets(r)).toHaveLength(0);
  });

  it('unmounts at once when the sheet is destroyed', () => {
    const r = mountHost();
    act(() => usePopupStore.getState().open({ message: 'torn down' }));
    act(() => usePopupStore.getState().destroySheet());
    expect(sheets(r)).toHaveLength(0);
  });

  it('keeps a custom sheet footer registered in its mount effect (Android NFC Close button)', () => {
    const r = mountHost();
    act(() => usePopupStore.getState().open({ sheetId: 'nfc-tap', payload: {} }));
    expect(r.root.findAll((node) => node.props.testID === 'nfc-close').length).toBeGreaterThan(0);
  });
});
