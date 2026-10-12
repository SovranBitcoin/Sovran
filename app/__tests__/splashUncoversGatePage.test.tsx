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
import { log } from '@/shared/lib/logger';
import { useShownInsteadOfWallet } from '@/shared/lib/qrButtonAnchor';

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
});
