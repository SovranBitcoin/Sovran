/**
 * @jest-environment node
 *
 * Who holds the NFC reader, as the flows that share it see it: the scan
 * source keeps an ambient cycle's failed reads quiet but shows them to an
 * explicit Tap to pay press, and an explicit press keeps the session when its
 * sheet closes once the payment machine reports that ecash is being created
 * or written. The real NFC session, scan source and tap-to-pay code run; only
 * `react-native-nfc-manager` and the app modules the payment config imports
 * are replaced.
 */

import { Platform } from 'react-native';
import NfcManager from 'react-native-nfc-manager';
import { createPaymentMachine } from 'wallet';

import { runTapToPayScan } from '@/features/send/lib/runTapToPayScan';
import {
  createSovranNotifications,
  createSovranScanSources,
} from '@/features/send/lib/sovranPaymentConfig';
import { NfcError, holdNfcReader, nfcReader } from '@/shared/lib/nfc';
import { acquireSession } from '@/shared/lib/nfc/session';
import { paramPopup, staticPopup } from '@/shared/lib/popup';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import { useNfcTapStore } from '@/shared/stores/runtime/nfcTapStore';

jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {
    start: jest.fn(async () => undefined),
    isSupported: jest.fn(async () => true),
    isEnabled: jest.fn(async () => true),
    cancelTechnologyRequest: jest.fn(async () => undefined),
    requestTechnology: jest.fn(async () => 'IsoDep'),
  },
  NfcTech: { IsoDep: 'IsoDep' },
  NfcAdapter: { FLAG_READER_NFC_A: 1, FLAG_READER_NFC_B: 2 },
  NfcError: { UserCancel: class UserCancel extends Error {} },
}));
jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), replace: jest.fn(), dismiss: jest.fn() },
  useSegments: jest.fn(() => []),
}));
jest.mock('expo-camera', () => ({ scanFromURLAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/features/bitchat/hooks/useBitchatNickname', () => ({
  getBitchatNickname: jest.fn(() => 'Self Sender'),
}));
jest.mock('@/features/bitchat/lib/profileScope', () => ({
  getBitchatProfileScope: jest.fn(() => 'profile-scope'),
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  nfcLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  mintUrlLogFields: jest.fn(() => ({ mintHost: 'mint.example', mintHash: 'mock-hash' })),
}));
jest.mock('@/shared/lib/id', () => ({ mintLocalId: jest.fn((prefix: string) => `${prefix}-id`) }));
jest.mock('@/shared/lib/cashu/utils', () => ({ buildReceiveHistoryEntry: jest.fn() }));
jest.mock('@/shared/lib/third-party/emoji', () => ({ decode: jest.fn(), isEncoded: jest.fn() }));
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: jest.fn(),
  linkTransactionAnnotation: jest.fn(),
  setDistributionAnnotation: jest.fn(),
}));
jest.mock('@/shared/lib/popup', () => ({
  copyPopup: jest.fn(),
  copyTokenAsEmoji: jest.fn(),
  nfcConnectionLostPopup: jest.fn(),
  nfcEcashSharedPopup: jest.fn(),
  nfcSendFailedPopup: jest.fn(),
  paymentCancelledPopup: jest.fn(),
  paymentStatusPopup: jest.fn(),
  sendMemoPopup: jest.fn(),
  staticPopup: jest.fn(),
  paramPopup: jest.fn(),
  showActionSheet: jest.fn((sheetId: string, payload: object) => {
    const { usePopupStore: store } = jest.requireActual<
      typeof import('@/shared/stores/runtime/popupStore')
    >('@/shared/stores/runtime/popupStore');
    const sheet: object = { sheetId, payload };
    store.getState().open(sheet as never);
  }),
}));
jest.mock('@/features/send/lib/paymentOptionPicker', () => ({
  choosePaymentOption: jest.fn(),
  chooseFallbackPaymentOption: jest.fn(),
}));
jest.mock('@/features/send/lib/proofSelectorPicker', () => ({ chooseProofs: jest.fn() }));
jest.mock('@/features/send/lib/sendFallbackPicker', () => ({ chooseSendFallback: jest.fn() }));
jest.mock('@/shared/hooks/useTransactionLocation', () => ({
  captureAndStoreLocation: jest.fn(),
}));
jest.mock('@/shared/stores/runtime/nearPayStore', () => ({
  useNearPaySessionStore: { getState: jest.fn(() => ({ active: null })) },
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: { getState: jest.fn(() => ({ selectedMint: null })) },
}));
jest.mock('@/shared/stores/profile/npcMintStore', () => ({
  useNpcMintStore: { getState: jest.fn(() => ({ getActiveMintUrl: jest.fn() })) },
}));
jest.mock('@/shared/lib/cashu/npc', () => ({ getNpcAddress: jest.fn() }));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: { getState: jest.fn(() => ({})) },
}));
jest.mock('@/shared/stores/profile/scanHistoryStore', () => ({
  useScanHistoryStore: { getState: jest.fn(() => ({})) },
}));
jest.mock('@/shared/stores/profile/sendReachabilityStore', () => ({
  useSendReachabilityStore: {
    getState: jest.fn(() => ({ markChecking: jest.fn(), pruneOld: jest.fn() })),
  },
}));
jest.mock('@/shared/stores/profile/transactionDistributionStore', () => ({
  useTransactionDistributionStore: { getState: jest.fn(() => ({})) },
}));

const native = jest.mocked(NfcManager);

function failingRead(error: Error) {
  return {
    readPaymentRequest: jest.fn(async () => {
      throw error;
    }),
    writeToken: jest.fn(async () => undefined),
    releaseSession: jest.fn(async () => undefined),
    isAvailable: jest.fn(async () => true),
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
let originalOS: typeof Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  originalOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  usePopupStore.setState({ current: null, isOpen: false });
  useNfcTapStore.setState({ phase: 'armed' });
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
});

describe('the NFC scan source', () => {
  it('keeps NFC being off quiet during an ambient cycle and says so to an explicit press', async () => {
    const nfc = createSovranScanSources(
      failingRead(new NfcError('NFC is disabled in system settings', 'NOT_ENABLED'))
    ).nfc!;

    const releaseAmbient = holdNfcReader('ambient');
    expect(await nfc()).toEqual({ empty: true });
    expect(paramPopup).not.toHaveBeenCalled();
    releaseAmbient();

    expect(await nfc()).toEqual({ empty: true });
    expect(paramPopup).toHaveBeenCalledWith('nfc-error', {
      title: 'NFC is turned off',
      message: 'Turn on NFC in system settings to scan.',
    });
  });

  it('drops a garbled ambient read and reports it to an explicit press', async () => {
    const nfc = createSovranScanSources(failingRead(new Error('not a payment tag'))).nfc!;

    const releaseAmbient = holdNfcReader('ambient');
    expect(await nfc()).toEqual({ empty: true });
    releaseAmbient();

    expect(await nfc()).toEqual({ error: new Error('not a payment tag') });
  });
});

describe('the reader', () => {
  // The wallet blurs: its ambient cycle's hold is dropped at once, though the
  // cycle's scan settles later. A press taken meanwhile is explicit, and the
  // late release leaves it so.
  it('belongs to the latest flow to take it, whatever an earlier hold does after', async () => {
    const nfc = createSovranScanSources(
      failingRead(new NfcError('NFC is disabled in system settings', 'NOT_ENABLED'))
    ).nfc!;
    const releaseAmbientCycle = holdNfcReader('ambient');
    releaseAmbientCycle();
    const releasePress = holdNfcReader('explicit');

    releaseAmbientCycle();
    expect(nfcReader()).toEqual({ holder: 'explicit', read: false, writingBack: false });
    expect(await nfc()).toEqual({ empty: true });
    expect(paramPopup).toHaveBeenCalledTimes(1);

    releasePress();
    expect(nfcReader()).toEqual({ holder: 'idle' });
  });
});

describe('an explicit Tap to pay press', () => {
  it.each(['creating', 'writing'] as const)(
    'keeps the session when its sheet closes while the machine reports %s',
    async (phase) => {
      const notifications = createSovranNotifications();
      let answer!: () => void;
      const run = runTapToPayScan(
        () =>
          new Promise<void>((resolve) => {
            answer = resolve;
            void acquireSession().then(() => {
              void notifications.onNfcPaymentProgress!({ phase });
            });
          })
      );
      await settle();
      const cancels = native.cancelTechnologyRequest.mock.calls.length;

      usePopupStore.getState().close();

      expect(native.cancelTechnologyRequest).toHaveBeenCalledTimes(cancels);
      answer();
      await run;
    }
  );

  // The scan source closes the sheet itself once the tag is read; the
  // payment machine still needs the session to write the ecash back.
  it('keeps the session when the scan source closes its sheet after a successful read', async () => {
    const nfc = createSovranScanSources({
      readPaymentRequest: jest.fn(async () => {
        await acquireSession();
        return 'creqA-from-terminal';
      }),
      writeToken: jest.fn(async () => undefined),
      releaseSession: jest.fn(async () => undefined),
      isAvailable: jest.fn(async () => true),
    }).nfc!;
    let cancels = 0;
    native.requestTechnology.mockImplementationOnce(async () => {
      cancels = native.cancelTechnologyRequest.mock.calls.length;
      return 'IsoDep' as never;
    });
    let read: unknown;

    await runTapToPayScan(async () => {
      read = await nfc();
    });

    expect(read).toEqual({ data: 'creqA-from-terminal' });
    expect(usePopupStore.getState().current).toBeNull();
    expect(native.cancelTechnologyRequest).toHaveBeenCalledTimes(cancels);
  });

  it('cancels the read when its sheet closes while the machine is still selecting', async () => {
    const notifications = createSovranNotifications();
    let answer!: () => void;
    const run = runTapToPayScan(
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
          void acquireSession().then(() => {
            void notifications.onNfcPaymentProgress!({ phase: 'selecting' });
          });
        })
    );
    await settle();
    const cancels = native.cancelTechnologyRequest.mock.calls.length;

    usePopupStore.getState().close();

    expect(native.cancelTechnologyRequest).toHaveBeenCalledTimes(cancels + 1);
    answer();
    await run;
  });
});

// A read that succeeds while a payment is being made is not taken by the
// payment machine: its session is let go at once, and an explicit press is
// told to try again, while an ambient cycle stays quiet.
describe('a read the payment machine is too busy to take', () => {
  const REQUEST =
    'creqApGF0gaNhdGRwb3N0YWF4GWh0dHBzOi8vbWludDEuZXhhbXBsZS5jb21hZ/dhYRhkYXVjc2F0YW2BeBlodHRwczovL21pbnQxLmV4YW1wbGUuY29t';
  const MINT = 'https://mint1.example.com';

  async function busyMachine() {
    const adapter = {
      readPaymentRequest: jest.fn(async () => {
        await acquireSession();
        return REQUEST;
      }),
      writeToken: jest.fn(async () => undefined),
      releaseSession: jest.fn(async () => undefined),
      isAvailable: jest.fn(async () => true),
    };
    let finishSend!: () => void;
    const machine = createPaymentMachine({
      handlers: {},
      getContext: () => ({
        trustedMintUrls: [MINT],
        mintBalances: { [MINT]: 1000 },
        proofAmounts: {},
      }),
      getUnit: () => 'sat',
      nfcAdapter: adapter,
      notifications: createSovranNotifications(),
      scanSources: createSovranScanSources(adapter),
      operations: {
        executeSend: jest.fn(
          () =>
            new Promise<{ historyEntry: string }>((resolve) => {
              finishSend = () => resolve({ historyEntry: '{"id":"tx-1","type":"send"}' });
            })
        ),
        executeMintQuote: jest.fn(),
        buildMintListItems: jest.fn(async () => []),
        executeNfcSend: jest.fn(),
      },
    });
    await machine.startSendEcash({ reset: true });
    const sending = machine.enterAmount({ value: 10, unit: 'sat' }, MINT, {
      destination: 'sendEcash',
    });
    for (let i = 0; i < 50 && finishSend === undefined; i += 1) await settle();
    return { machine, adapter, done: () => (finishSend(), sending) };
  }

  it('lets the session go and asks an explicit press to try again', async () => {
    const { machine, adapter, done } = await busyMachine();
    const releasePress = holdNfcReader('explicit');

    await machine.scan!(undefined, { source: 'nfc' });

    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);
    expect(staticPopup).toHaveBeenCalledWith('general-error', expect.anything());
    expect(adapter.writeToken).not.toHaveBeenCalled();
    releasePress();
    await done();
  });

  it('lets the session go quietly during an ambient cycle', async () => {
    const { machine, adapter, done } = await busyMachine();
    const releaseAmbient = holdNfcReader('ambient');

    await machine.scan!(undefined, { source: 'nfc' });

    expect(adapter.releaseSession).toHaveBeenCalledTimes(1);
    expect(staticPopup).not.toHaveBeenCalled();
    releaseAmbient();
    await done();
  });
});
