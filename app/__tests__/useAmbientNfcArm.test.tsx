/**
 * @jest-environment node
 *
 * Characterization of `useAmbientNfcArm`, the wallet screen's always-on NFC
 * read loop: when it arms (focus, foreground, Android, NFC supported and on, no
 * other popup), what each cycle does (clear the payment context, mark the cycle
 * ambient, ask the machine for an NFC scan, re-arm), how a tag arrival surfaces
 * the tap sheet, and what it tears down when it disarms. The NFC module, the
 * focus hook and the payment-context reset are replaced; the popup and tap
 * stores are real.
 */

import { AppState, Platform } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { useAmbientNfcArm } from '@/features/wallet/hooks/useAmbientNfcArm';
import { holdNfcReader, isNfcEnabled, isNfcSupported, releaseSession } from '@/shared/lib/nfc';
import { showActionSheet } from '@/shared/lib/popup';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import { useNfcTapStore } from '@/shared/stores/runtime/nfcTapStore';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';

const mockFocus: { blur: (() => void) | null; refocus: (() => void) | null } = {
  blur: null,
  refocus: null,
};

jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      const [focused, setFocused] = ReactActual.useState(true);
      mockFocus.blur = () => setFocused(false);
      mockFocus.refocus = () => setFocused(true);
      ReactActual.useEffect(() => {
        if (!focused) return undefined;
        return effect() ?? undefined;
      }, [effect, focused]);
    },
  };
});
jest.mock('@/shared/lib/nfc', () => ({
  isNfcEnabled: jest.fn(),
  isNfcSupported: jest.fn(),
  releaseSession: jest.fn(async () => undefined),
  holdNfcReader: jest.fn(),
}));
jest.mock('@/shared/lib/popup', () => ({ showActionSheet: jest.fn() }));
jest.mock('@/shared/stores/runtime/clearPaymentContext', () => ({
  clearPaymentContext: jest.fn(),
}));

/** A store payload of the loose shape these cases need. */
const loose = (value: object): never => value as never;

const appStateListeners: ((state: string) => void)[] = [];
let originalOS: typeof Platform.OS;

type Scan = jest.Mock<Promise<unknown>, [undefined?, { source: 'nfc' }?]>;

/** A scan that stays out until the test answers it, like a held NFC session. */
function heldScan() {
  const pending: (() => void)[] = [];
  const scan: Scan = jest.fn(
    () =>
      new Promise<unknown>((resolve) => {
        pending.push(() => resolve(undefined));
      })
  );
  return { scan, answer: () => pending.shift()?.() };
}

async function flush(ms = 0) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function setForeground(state: 'active' | 'background') {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
  act(() => appStateListeners.forEach((listener) => listener(state)));
}

/** Releases of the reader holds the hook took, one mock per hold. */
let releases: jest.Mock[] = [];
/** Whether the latest hold on the reader is still held. */
const holding = () => releases.length > 0 && releases.at(-1)!.mock.calls.length === 0;

function tagArrives() {
  const listener = jest.mocked(holdNfcReader).mock.calls.at(-1)![1]!;
  act(() => listener());
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  releases = [];
  jest.mocked(holdNfcReader).mockImplementation(() => {
    const release = jest.fn();
    releases.push(release);
    return release;
  });
  originalOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  appStateListeners.length = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    listener: (state: string) => void
  ) => {
    appStateListeners.push(listener);
    return { remove: jest.fn() };
  }) as never);
  jest.mocked(isNfcSupported).mockResolvedValue(true);
  jest.mocked(isNfcEnabled).mockResolvedValue(true);
  usePopupStore.setState({ current: null, isOpen: false });
  useNfcTapStore.setState({ phase: 'armed' });
  useSwapStatusStore.setState(loose({ active: null }));
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('arming', () => {
  it('does nothing off Android', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const { scan } = heldScan();
    renderHook(() => useAmbientNfcArm({ scan }));
    await flush(10_000);

    expect(isNfcSupported).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });

  it('does nothing when the phone has no NFC', async () => {
    jest.mocked(isNfcSupported).mockResolvedValue(false);
    const { scan } = heldScan();
    renderHook(() => useAmbientNfcArm({ scan }));
    await flush(10_000);

    expect(scan).not.toHaveBeenCalled();
  });

  it('arms, clears the payment context, holds the reader as ambient and asks for an NFC scan', async () => {
    const { scan } = heldScan();
    renderHook(() => useAmbientNfcArm({ scan }));
    await flush();

    expect(clearPaymentContext).toHaveBeenCalledWith('wallet.nfc_ambient');
    expect(holdNfcReader).toHaveBeenCalledWith('ambient', expect.any(Function));
    expect(holding()).toBe(true);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledWith(undefined, { source: 'nfc' });
  });

  it('re-arms 600 ms after each cycle ends, even when the scan throws', async () => {
    const scan: Scan = jest.fn(async () => {
      throw new Error('timed out');
    });
    renderHook(() => useAmbientNfcArm({ scan }));
    await flush();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(holding()).toBe(false);

    await flush(599);
    expect(scan).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('waits disarmed while NFC is off and arms once it is turned on', async () => {
    jest.mocked(isNfcEnabled).mockResolvedValue(false);
    const { scan } = heldScan();
    renderHook(() => useAmbientNfcArm({ scan }));
    await flush(3_999);
    expect(scan).not.toHaveBeenCalled();

    jest.mocked(isNfcEnabled).mockResolvedValue(true);
    await flush(1);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('pauses without clearing anything while another popup is up, and resumes after it closes', async () => {
    usePopupStore.setState({ current: loose({ message: 'Pick a mint' }), isOpen: true });
    const { scan } = heldScan();
    renderHook(() => useAmbientNfcArm({ scan }));
    await flush(3_000);

    expect(scan).not.toHaveBeenCalled();
    expect(clearPaymentContext).not.toHaveBeenCalled();

    usePopupStore.setState({ current: null, isOpen: false });
    await flush(1_500);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('keeps scanning while its own tap sheet is up', async () => {
    usePopupStore.setState({ current: loose({ sheetId: 'nfc-tap', payload: {} }), isOpen: true });
    const { scan } = heldScan();
    renderHook(() => useAmbientNfcArm({ scan }));
    await flush();

    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('keeps scanning while a swap is running', async () => {
    useSwapStatusStore.setState(loose({ active: { state: 'running' } }));
    const { scan } = heldScan();
    renderHook(() => useAmbientNfcArm({ scan }));
    await flush();

    // QUIRK: the wallet screen gates every payment button during a swap, but the ambient
    // NFC loop (which can auto-pay a tapped request) is not gated.
    expect(scan).toHaveBeenCalledTimes(1);
    expect(clearPaymentContext).toHaveBeenCalledWith('wallet.nfc_ambient');
  });

  it('uses the latest machine for the next cycle without restarting the loop', async () => {
    const first = heldScan();
    const second = heldScan();
    const { rerender } = renderHook(({ scan }: { scan: Scan }) => useAmbientNfcArm({ scan }), {
      initialProps: { scan: first.scan },
    });
    await flush();

    rerender({ scan: second.scan });
    await flush();
    expect(releaseSession).not.toHaveBeenCalled();

    first.answer();
    await flush(600);
    expect(first.scan).toHaveBeenCalledTimes(1);
    expect(second.scan).toHaveBeenCalledTimes(1);
  });
});

describe('a tag arriving', () => {
  it('shows the tap sheet as reading when nothing else is up', async () => {
    renderHook(() => useAmbientNfcArm({ scan: heldScan().scan }));
    await flush();

    tagArrives();

    expect(useNfcTapStore.getState().phase).toBe('reading');
    expect(showActionSheet).toHaveBeenCalledWith('nfc-tap', {});
  });

  it('does not cover another popup', async () => {
    renderHook(() => useAmbientNfcArm({ scan: heldScan().scan }));
    await flush();
    usePopupStore.setState({ current: loose({ message: 'Other' }), isOpen: true });

    tagArrives();

    expect(useNfcTapStore.getState().phase).toBe('reading');
    expect(showActionSheet).not.toHaveBeenCalled();
  });

  it('stops reopening the sheet once it was dismissed, until the wallet is focused again', async () => {
    renderHook(() => useAmbientNfcArm({ scan: heldScan().scan }));
    await flush();
    act(() => usePopupStore.setState({ current: loose({ sheetId: 'nfc-tap', payload: {} }) }));
    act(() => usePopupStore.setState({ current: null }));

    tagArrives();
    expect(showActionSheet).not.toHaveBeenCalled();

    act(() => mockFocus.blur!());
    act(() => mockFocus.refocus!());
    await flush();
    tagArrives();
    expect(showActionSheet).toHaveBeenCalledTimes(1);
  });
});

describe('disarming', () => {
  it('on blur releases the session and the reader, resets the store and closes its sheet', async () => {
    const { scan } = heldScan();
    renderHook(() => useAmbientNfcArm({ scan }));
    await flush();
    usePopupStore.setState({ current: loose({ sheetId: 'nfc-tap', payload: {} }), isOpen: true });
    useNfcTapStore.setState({ phase: 'reading' });

    act(() => mockFocus.blur!());

    expect(releaseSession).toHaveBeenCalledTimes(1);
    expect(holding()).toBe(false);
    expect(useNfcTapStore.getState().phase).toBe('armed');
    expect(usePopupStore.getState().current).toBeNull();
  });

  it('leaves another popup alone on blur', async () => {
    renderHook(() => useAmbientNfcArm({ scan: heldScan().scan }));
    await flush();
    usePopupStore.setState({ current: loose({ message: 'Other' }), isOpen: true });

    act(() => mockFocus.blur!());

    expect(usePopupStore.getState().current).toEqual({ message: 'Other' });
  });

  it('starts no further cycle after blur, and starts again on refocus', async () => {
    const { scan, answer } = heldScan();
    renderHook(() => useAmbientNfcArm({ scan }));
    await flush();

    act(() => mockFocus.blur!());
    answer();
    await flush(5_000);
    expect(scan).toHaveBeenCalledTimes(1);

    act(() => mockFocus.refocus!());
    await flush();
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('disarms in the background and arms again back in the foreground', async () => {
    const { scan, answer } = heldScan();
    renderHook(() => useAmbientNfcArm({ scan }));
    await flush();

    setForeground('background');
    expect(releaseSession).toHaveBeenCalledTimes(1);
    answer();
    await flush(5_000);
    expect(scan).toHaveBeenCalledTimes(1);

    setForeground('active');
    await flush();
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('never starts a scan when the screen blurs while NFC is being checked', async () => {
    let enabledAnswer!: (value: boolean) => void;
    jest.mocked(isNfcEnabled).mockReturnValueOnce(
      new Promise((resolve) => {
        enabledAnswer = resolve;
      })
    );
    const { scan } = heldScan();
    renderHook(() => useAmbientNfcArm({ scan }));
    await flush();

    act(() => mockFocus.blur!());
    enabledAnswer(true);
    await flush(5_000);

    expect(scan).not.toHaveBeenCalled();
  });
});
