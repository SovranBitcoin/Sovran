/**
 * The boot splash and a page shown in place of the wallet home.
 *
 * The splash waits for the wallet home's QR button so it can morph into it.
 * On a first launch the app shows the Terms page instead, which was ready
 * after two seconds and stayed covered for nine while the splash waited out
 * its eight-second fallback. A page the gate shows in place of the wallet
 * says so, and the splash uncovers it at once.
 */
import { act, render, screen } from '@testing-library/react-native';

import { NativeSplashLayoutGate } from '@/shared/blocks/NativeSplashLayoutGate';
import { initializationStages } from '@/runtime/initializationStages';
import { log } from '@/shared/lib/logger';
import {
  getBootMorphCompleted,
  getBootSplashHandoff,
  setQRButtonAnchor,
  useShownInsteadOfWallet,
} from '@/shared/lib/qrButtonAnchor';

jest.mock('expo-splash-screen', () => ({ hideAsync: jest.fn(async () => true) }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => ['black'] }));
// Under Jest the app's `Image` is the web one, which cannot size a bundled asset.
jest.mock('react-native-web/dist/exports/Image', () => {
  const actual = jest.requireActual('react-native-web/dist/exports/Image');
  actual.default.resolveAssetSource = () => ({ width: 2048, height: 2048 });
  return actual;
});

function GatePage() {
  useShownInsteadOfWallet();
  return null;
}

/** The root view reporting its layout is what lets the native splash go. */
function layOutRoot() {
  const [root] = screen.UNSAFE_root.findAll((node) => typeof node.props.onLayout === 'function');
  act(() => {
    (root.props as { onLayout: () => void }).onLayout();
  });
}

describe('the boot splash over a page shown in place of the wallet home', () => {
  let info: jest.SpyInstance;
  const splashGone = () => info.mock.calls.some(([event]) => event === 'splash.gone');

  beforeEach(() => {
    jest.useFakeTimers();
    info = jest.spyOn(log, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    setQRButtonAnchor(null);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('uncovers the page within a second instead of waiting for a QR button', () => {
    render(
      <NativeSplashLayoutGate>
        <GatePage />
      </NativeSplashLayoutGate>
    );
    layOutRoot();

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(splashGone()).toBe(true);
  });

  it('exposes the currently covering overlay again after a completed cycle remounts', () => {
    // The node preset renders RN Web host elements, which translate testID to data-testid.
    const overlayMounted = () =>
      screen.UNSAFE_root.findAll(
        (node) => node.type === 'div' && node.props['data-testid'] === 'boot-splash-overlay'
      ).length > 0;
    const gate = (key: string) => (
      <NativeSplashLayoutGate key={key}>
        <GatePage />
      </NativeSplashLayoutGate>
    );
    render(gate('first'));
    expect(overlayMounted()).toBe(true);
    layOutRoot();
    act(() => jest.advanceTimersByTime(1000));
    expect(overlayMounted()).toBe(false);
    expect(splashGone()).toBe(true);

    screen.unmount();
    render(gate('second'));
    expect(overlayMounted()).toBe(true);
    expect(getBootMorphCompleted()).toBe(false);
    expect(getBootSplashHandoff()).toBe(false);
    layOutRoot();
    act(() => jest.advanceTimersByTime(1000));
    expect(overlayMounted()).toBe(false);
  });

  it('morphs once the wallet publishes its QR anchor and signals completion after docking', () => {
    render(<NativeSplashLayoutGate>{null}</NativeSplashLayoutGate>);
    layOutRoot();
    act(() => {
      setQRButtonAnchor({ x: 120, y: 350, width: 72, height: 72, borderRadius: 16 });
    });
    act(() => jest.advanceTimersByTime(600));

    expect(getBootSplashHandoff()).toBe(true);
    expect(getBootMorphCompleted()).toBe(false);
    expect(splashGone()).toBe(false);

    act(() => jest.advanceTimersByTime(800));
    expect(getBootMorphCompleted()).toBe(true);
    expect(info).toHaveBeenCalledWith('splash.gone', { by: 'morph' });
  });

  it('still waits for the wallet home when no such page is shown', () => {
    render(
      <NativeSplashLayoutGate>
        <></>
      </NativeSplashLayoutGate>
    );
    layOutRoot();

    act(() => {
      jest.advanceTimersByTime(7000);
    });
    expect(splashGone()).toBe(false);

    // The fallback for a wallet home that never arrives is unchanged: it gives
    // up at eight seconds, then fades.
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(splashGone()).toBe(true);
  });

  it('does not loop the splash when initialization is still running past the fallback timeout', () => {
    const overlayMounted = () =>
      screen.UNSAFE_root.findAll(
        (node) => node.type === 'div' && node.props['data-testid'] === 'boot-splash-overlay'
      ).length > 0;
    initializationStages.resetStages();
    try {
      render(
        <NativeSplashLayoutGate>
          <></>
        </NativeSplashLayoutGate>
      );
      layOutRoot();

      // Past the 8s fallback + fade: overlay unmounts and MUST NOT bounce back to await_init.
      act(() => jest.advanceTimersByTime(8_500));
      act(() => jest.advanceTimersByTime(1_000));
      expect(overlayMounted()).toBe(false);

      // Even after another full cycle, it stays unmounted while the same boot continues.
      act(() => jest.advanceTimersByTime(10_000));
      expect(overlayMounted()).toBe(false);

      // Once boot finishes (isInitializing -> false) and a profile switch resets stages
      // (isInitializing false -> true), the splash replays as expected.
      act(() => initializationStages.cancelResetStages());
      act(() => initializationStages.resetStages());
      expect(overlayMounted()).toBe(true);
    } finally {
      act(() => initializationStages.cancelResetStages());
    }
  });
});

it('keeps the splash over the outgoing wallet until the switch releases it', () => {
  jest.useFakeTimers();
  const anchor = { x: 120, y: 350, width: 72, height: 72, borderRadius: 16 };
  try {
    render(<NativeSplashLayoutGate>{null}</NativeSplashLayoutGate>);
    layOutRoot();
    act(() => setQRButtonAnchor(anchor));
    act(() => jest.advanceTimersByTime(600));
    act(() => jest.advanceTimersByTime(800));
    expect(getBootMorphCompleted()).toBe(true);

    act(() => initializationStages.holdForProfileSwitch());
    act(() => jest.advanceTimersByTime(9000));
    expect(getBootSplashHandoff()).toBe(false);
    expect(getBootMorphCompleted()).toBe(false);

    act(() => initializationStages.cancelResetStages());
    act(() => jest.advanceTimersByTime(600));
    act(() => jest.advanceTimersByTime(800));
    expect(getBootMorphCompleted()).toBe(true);
  } finally {
    act(() => initializationStages.cancelResetStages());
    setQRButtonAnchor(null);
    jest.useRealTimers();
  }
});
