/**
 * @jest-environment node
 *
 * Characterization of `runTapToPayScan`, the Send screen's explicit "Tap to
 * pay" press: on Android it shows the tap sheet, turns it to "Reading" when a
 * tag connects, re-arms while the sheet stays open, cancels the read when the
 * person closes the sheet before the tag is read, and tears down after. (That
 * it keeps the session once ecash is being created or written, and through the
 * real scan source's close, is pinned in nfcReaderOwnership.test.ts.)
 * The real NFC session code runs; only `react-native-nfc-manager` and the
 * sheet presenter are replaced. The popup and tap stores are real.
 */

import { Platform } from 'react-native';
import NfcManager from 'react-native-nfc-manager';

import { runTapToPayScan } from '@/features/send/lib/runTapToPayScan';
import { nfcTagRead } from '@/shared/lib/nfc/reader';
import { acquireSession } from '@/shared/lib/nfc/session';
import { showActionSheet } from '@/shared/lib/popup';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import { useNfcTapStore } from '@/shared/stores/runtime/nfcTapStore';

jest.mock('@/shared/lib/logger', () => {
  const quiet = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { nfcLog: quiet, paymentLog: quiet, storeLog: quiet, walletLog: quiet };
});
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
jest.mock('@/shared/lib/popup', () => ({
  showActionSheet: jest.fn((sheetId: string, payload: object) => {
    const { usePopupStore: store } = jest.requireActual<
      typeof import('@/shared/stores/runtime/popupStore')
    >('@/shared/stores/runtime/popupStore');
    const sheet: object = { sheetId, payload };
    store.getState().open(sheet as never);
  }),
}));

const native = jest.mocked(NfcManager);
let originalOS: typeof Platform.OS;

/** Cancels of the native session after the tag connected (acquire cancels a stale one first). */
let cancelsBeforeTag = 0;
const releases = () => native.cancelTechnologyRequest.mock.calls.length - cancelsBeforeTag;

/** A tag connects: the real session acquire, as a scan's read does first. */
async function tagConnects() {
  await acquireSession();
  cancelsBeforeTag = native.cancelTechnologyRequest.mock.calls.length;
}

const closeSheet = () => usePopupStore.getState().close();
const tapSheetOpen = () => {
  const { current } = usePopupStore.getState();
  return current != null && 'sheetId' in current && current.sheetId === 'nfc-tap';
};

/** A scan that stays out until the test answers it, like a held NFC read. */
function heldScan(onStart?: () => Promise<void> | void) {
  const pending: (() => void)[] = [];
  const scan = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
        void onStart?.();
      })
  );
  return { scan, answer: () => pending.shift()?.() };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  cancelsBeforeTag = 0;
  originalOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  usePopupStore.setState({ current: null, isOpen: false });
  useNfcTapStore.setState({ phase: 'armed' });
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.useRealTimers();
});

it('only runs the scan off Android', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  const scan = jest.fn(async () => undefined);

  await runTapToPayScan(scan);

  expect(scan).toHaveBeenCalledTimes(1);
  expect(showActionSheet).not.toHaveBeenCalled();
});

it('shows the tap sheet as armed and turns it to reading when a tag connects', async () => {
  const { scan, answer } = heldScan(tagConnects);
  const run = runTapToPayScan(scan);
  expect(showActionSheet).toHaveBeenCalledWith('nfc-tap', {});
  await settle();

  expect(useNfcTapStore.getState().phase).toBe('reading');
  closeSheet();
  answer();
  await run;
});

it('cancels the read when the sheet is closed while reading', async () => {
  const { scan, answer } = heldScan(tagConnects);
  const run = runTapToPayScan(scan);
  await settle();

  closeSheet();

  expect(releases()).toBe(1);
  answer();
  await run;
  expect(scan).toHaveBeenCalledTimes(1);
});

// A successful read closes the tap sheet itself, before the payment machine
// writes ecash back to the terminal. That close is not the person's: the
// session the write-back needs stays open, and the machine ends it.
it('keeps the session when the read closes the sheet itself', async () => {
  const { scan, answer } = heldScan(async () => {
    await tagConnects();
    nfcTagRead();
    closeSheet();
  });
  const run = runTapToPayScan(scan);
  await settle();

  expect(releases()).toBe(0);
  answer();
  await run;
});

it('re-arms 600 ms after a scan while the sheet stays open, and stops once it closes', async () => {
  jest.useFakeTimers();
  const { scan, answer } = heldScan();
  const run = runTapToPayScan(scan);
  answer();
  await jest.advanceTimersByTimeAsync(599);
  expect(scan).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(scan).toHaveBeenCalledTimes(2);

  closeSheet();
  answer();
  await jest.advanceTimersByTimeAsync(5_000);
  await run;
  expect(scan).toHaveBeenCalledTimes(2);
  expect(tapSheetOpen()).toBe(false);
});

it('leaves the phase armed and stops listening for tags once it ends', async () => {
  const { scan, answer } = heldScan();
  const run = runTapToPayScan(scan);
  closeSheet();
  answer();
  await run;
  expect(useNfcTapStore.getState().phase).toBe('armed');

  useNfcTapStore.getState().setPhase('selecting');
  await tagConnects();
  expect(useNfcTapStore.getState().phase).toBe('selecting');

  const sheet: object = { sheetId: 'nfc-tap', payload: {} };
  usePopupStore.getState().open(sheet as never);
  closeSheet();
  expect(releases()).toBe(0);
});
