/**
 * @jest-environment node
 *
 * What the camera overlay shows while a scan is in flight (busy, progress) and
 * which scans it admits meanwhile, for every way a scan settles: a finished
 * read, a multi-frame UR still collecting, a locked token waiting on a choice,
 * a failure, the screen regaining focus and the payment option sheet closing.
 * The payment machine is a fake whose scan the test resolves.
 */

/* eslint-disable import/first */

const mockLayout: { current: Record<string, unknown> | null } = { current: null };
const mockFocus: { effect: (() => void | (() => void)) | null } = { effect: null };
const mockFlow: { onOptionDismiss?: () => void } = {};
const mockMachine = { scan: jest.fn(), reset: jest.fn() };
const mockLogError = jest.fn();

jest.mock('wallet/react', () => ({
  usePaymentFlowMachine: (config: { onOptionDismiss?: () => void }) => {
    mockFlow.onOptionDismiss = config.onOptionDismiss;
    return mockMachine;
  },
}));
jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    useLocalSearchParams: () => ({}),
    useFocusEffect: (effect: () => void | (() => void)) => {
      mockFocus.effect = effect;
      ReactActual.useEffect(() => effect() ?? undefined, [effect]);
    },
  };
});
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { back: jest.fn() } }));
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(async () => '') }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'white' }));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: (select: (state: { selectedMint?: string }) => unknown) => select({}),
}));
jest.mock('@/shared/providers/WalletContextProvider', () => ({
  useWalletContextWithOverride: () => ({ trustedMintUrls: [], mintBalances: {} }),
}));
jest.mock('@/features/camera/hooks/useHandleCameraPermission', () => ({
  useHandleCameraPermission: () => ({ permission: { granted: true }, handlePermission: jest.fn() }),
}));
jest.mock('@/features/camera/screens/CameraScreen/CameraLayout', () => ({
  CameraLayout: ({ children, ...props }: { children: React.ReactNode }) => {
    mockLayout.current = props;
    return children;
  },
}));
jest.mock(
  '@/features/camera/screens/CameraScreen/CameraActionButtons',
  () => ({ CameraActionButtons: () => null }),
  { virtual: true }
);
jest.mock('@/features/nostrSigner', () => ({
  openPairingFromUri: jest.fn(),
  PAIRING_ERROR_TITLE: 'title',
  PAIRING_ERROR_INVALID_QR: 'qr',
  PAIRING_ERROR_INVALID_LINK: 'link',
  PAIRING_ERROR_BUNKER: 'bunker',
}));
jest.mock('@/shared/lib/popup', () => ({ popup: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: { children: React.ReactNode }) => children,
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: (...args: unknown[]) => mockLogError(...args),
  },
  useLifecycleLogger: jest.fn(),
}));

import React from 'react';
import { AppState } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { CameraScreen } from '@/features/camera/screens/CameraScreen/CameraScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Outcome = { urInProgress?: boolean; progress?: number; lockedPending?: boolean } | undefined;

let now = 1_000_000;
let renderer: TestRenderer.ReactTestRenderer;
let settle: ((outcome: Outcome) => void) | null = null;
let fail: ((error: Error) => void) | null = null;

function overlay() {
  const props = mockLayout.current as { loading: boolean; progress: number };
  return { loading: props.loading, progress: props.progress };
}

/** Scan `data` live; the machine's scan stays open until the test settles it. */
async function scan(data: string) {
  now += 1_000;
  await act(async () => {
    (mockLayout.current as { handleScan: (r: { data: string }) => void }).handleScan({ data });
  });
}

async function finish(outcome: Outcome) {
  await act(async () => settle?.(outcome));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(AppState, 'currentState', 'get').mockReturnValue('active');
  mockMachine.scan.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        settle = resolve;
        fail = reject;
      })
  );
  act(() => {
    renderer = TestRenderer.create(<CameraScreen />);
  });
});

afterEach(() => {
  act(() => renderer.unmount());
  jest.restoreAllMocks();
});

it('is busy while a scan runs and idle once it has been read', async () => {
  await scan('cashuAtoken');
  expect(overlay()).toEqual({ loading: true, progress: 0 });
  await finish(undefined);
  expect(overlay()).toEqual({ loading: false, progress: 0 });
  await scan('cashuAother');
  expect(mockMachine.scan).toHaveBeenCalledTimes(2);
});

it('keeps collecting a multi-frame UR, admitting only its frames until the last one', async () => {
  await scan('ur:bytes/1-3/frame-a');
  await finish({ urInProgress: true, progress: 0.33 });
  expect(overlay()).toEqual({ loading: true, progress: 0.33 });

  await scan('cashuAtoken');
  expect(mockMachine.scan).toHaveBeenCalledTimes(1);

  await scan('ur:bytes/2-3/frame-b');
  expect(mockMachine.scan).toHaveBeenCalledTimes(2);
  await finish({ urInProgress: true, progress: 0.66 });
  expect(overlay()).toEqual({ loading: true, progress: 0.66 });

  await scan('ur:bytes/3-3/frame-c');
  await finish({ progress: 1 });
  expect(overlay()).toEqual({ loading: false, progress: 0 });
});

it('stays busy while a locked token waits on a choice', async () => {
  await scan('cashuAlocked');
  await finish({ lockedPending: true });
  expect(overlay()).toEqual({ loading: true, progress: 0 });
  await scan('cashuAother');
  expect(mockMachine.scan).toHaveBeenCalledTimes(1);
});

it('unwinds and logs a scan that throws, then admits the next one', async () => {
  await scan('cashuAtoken');
  await act(async () => fail?.(new Error('decoder blew up')));
  expect(overlay()).toEqual({ loading: false, progress: 0 });
  expect(mockLogError).toHaveBeenCalledWith('camera.scan.failed', {
    error: new Error('decoder blew up'),
  });
  await scan('cashuAother');
  expect(mockMachine.scan).toHaveBeenCalledTimes(2);
});

it('clears a pending scan and resets the machine when the screen regains focus', async () => {
  await scan('ur:bytes/1-3/frame-a');
  await finish({ urInProgress: true, progress: 0.33 });
  mockMachine.reset.mockClear();
  act(() => {
    mockFocus.effect?.();
  });
  expect(overlay()).toEqual({ loading: false, progress: 0 });
  expect(mockMachine.reset).toHaveBeenCalledTimes(1);
  await scan('cashuAtoken');
  expect(mockMachine.scan).toHaveBeenCalledTimes(2);
});

it('stops being busy when the option sheet closes, keeping the progress shown', async () => {
  await scan('ur:bytes/1-3/frame-a');
  await finish({ urInProgress: true, progress: 0.5 });
  act(() => mockFlow.onOptionDismiss?.());
  expect(overlay()).toEqual({ loading: false, progress: 0.5 });
  await scan('cashuAtoken');
  expect(mockMachine.scan).toHaveBeenCalledTimes(2);
});
