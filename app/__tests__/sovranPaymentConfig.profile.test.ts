/**
 * @jest-environment node
 */

import type { PaymentMachine } from 'wallet';
import type { Manager } from '@cashu/coco-core';
import {
  createSovranHandlers,
  createSovranNotifications,
} from '@/features/send/lib/sovranPaymentConfig';
import { paramPopup, sendMemoPopup } from '@/shared/lib/popup';
import { getEncodedToken } from '@cashu/cashu-ts';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { paymentLog } from '@/shared/lib/logger';
import { useContactSendStore } from '@/shared/stores/runtime/contactSendStore';

const mockNavigate = jest.fn();
const mockBack = jest.fn();
const mockDismissAll = jest.fn();
const mockNearPayComplete = jest.fn();
const mockNearPaySetAmountEntry = jest.fn();
const mockNearPaySetMintPickerOpen = jest.fn();
let mockNearPayActive: unknown = null;

function paymentLogCalls(): unknown[][] {
  return [paymentLog.debug, paymentLog.info, paymentLog.warn, paymentLog.error].flatMap(
    (method) => (method as jest.Mock).mock.calls
  );
}

jest.mock('wallet', () => ({
  withTimeout: jest.fn((promise: Promise<unknown>) => promise),
  rawAnnotationKey: jest.fn((raw: string) => `raw:${raw}`),
}));

jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: jest.fn(),
  linkTransactionAnnotation: jest.fn(),
  setDistributionAnnotation: jest.fn(),
}));

jest.mock('expo-router', () => ({
  router: {
    navigate: (...args: unknown[]) => mockNavigate(...args),
    back: (...args: unknown[]) => mockBack(...args),
    replace: jest.fn(),
    dismiss: jest.fn(),
    dismissAll: (...args: unknown[]) => mockDismissAll(...args),
  },
  useSegments: jest.fn(() => []),
}));

jest.mock('expo-camera', () => ({ scanFromURLAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('react-native', () => ({ Share: { share: jest.fn() } }));
jest.mock('@/shared/lib/interactions', () => ({
  // The DM-thread navigate is deferred behind the interaction settle; run it
  // synchronously here — the pinned contract is dismissAll-before-navigate.
  runAfterInteractions: (callback: () => void) => callback(),
}));
jest.mock('@cashu/cashu-ts', () => ({ getDecodedToken: jest.fn(), getEncodedToken: jest.fn() }));
jest.mock('@/features/bitchat/hooks/useBitchatNickname', () => ({
  getBitchatNickname: jest.fn(() => 'Self Sender'),
}));
jest.mock('@/features/bitchat/lib/profileScope', () => ({
  getBitchatProfileScope: jest.fn(() => 'profile-scope'),
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/shared/lib/id', () => ({ mintLocalId: jest.fn((prefix: string) => `${prefix}-id`) }));
jest.mock('@/shared/lib/cashu/utils', () => ({ buildReceiveHistoryEntry: jest.fn() }));
jest.mock('@/shared/lib/third-party/emoji', () => ({
  decode: jest.fn(),
  isEncoded: jest.fn(),
}));
jest.mock('@/shared/lib/nfc', () => ({
  writeTokenToNFC: jest.fn(),
  NfcError: class NfcError extends Error {},
  isUserCancelError: jest.fn(() => false),
}));
jest.mock('@/shared/lib/popup', () => ({
  copyPopup: jest.fn(),
  emojiPickerPopup: jest.fn(),
  nfcConnectionLostPopup: jest.fn(),
  nfcEcashSharedPopup: jest.fn(),
  nfcSendFailedPopup: jest.fn(),
  paymentCancelledPopup: jest.fn(),
  paymentFallbackPopup: jest.fn(),
  paymentOptionsPopup: jest.fn(),
  paymentStatusPopup: jest.fn(),
  proofSelectorPopup: jest.fn(),
  sendMemoPopup: jest.fn(),
  staticPopup: jest.fn(),
  paramPopup: jest.fn(),
}));
jest.mock('@/shared/hooks/useTransactionLocation', () => ({
  captureAndStoreLocation: jest.fn(),
}));
jest.mock('@/shared/lib/routstr/topUp', () => ({
  executeRoutstrTopUp: jest.fn(),
  formatRoutstrBalance: jest.fn(),
}));
jest.mock('@/shared/stores/runtime/routstrTopUpStore', () => ({
  useRoutstrTopUpStore: { getState: jest.fn(() => ({ phase: 'idle', complete: jest.fn() })) },
}));
jest.mock('@/shared/stores/runtime/nearPayStore', () => ({
  useNearPaySessionStore: {
    getState: jest.fn(() => ({
      active: mockNearPayActive,
      complete: mockNearPayComplete,
      setAmountEntry: mockNearPaySetAmountEntry,
      setMintPickerOpen: mockNearPaySetMintPickerOpen,
    })),
  },
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: { getState: jest.fn(() => ({ selectedMint: null })) },
}));
jest.mock('@/shared/stores/profile/npcMintStore', () => ({
  useNpcMintStore: { getState: jest.fn(() => ({ getActiveMintUrl: jest.fn() })) },
}));
jest.mock('@/shared/lib/cashu/npc', () => ({ getNpcAddress: jest.fn() }));
jest.mock('@/shared/stores/runtime/paymentStatusStore', () => ({
  usePaymentStatusStore: { getState: jest.fn(() => ({})) },
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: { getState: jest.fn(() => ({})) },
}));
jest.mock('@/shared/stores/profile/scanHistoryStore', () => ({
  useScanHistoryStore: { getState: jest.fn(() => ({})) },
}));
jest.mock('@/shared/stores/profile/sendReachabilityStore', () => ({
  useSendReachabilityStore: {
    getState: jest.fn(() => ({
      markChecking: jest.fn(),
      pruneOld: jest.fn(),
    })),
  },
}));
jest.mock('@/shared/stores/profile/transactionDistributionStore', () => ({
  useTransactionDistributionStore: { getState: jest.fn(() => ({})) },
}));

describe('createSovranHandlers profile routing', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockDismissAll.mockReset();
    mockBack.mockReset();
    mockNearPayComplete.mockReset();
    mockNearPaySetAmountEntry.mockReset();
    mockNearPaySetMintPickerOpen.mockReset();
    mockNearPayActive = null;
    (getEncodedToken as jest.Mock).mockReset();
    (sendMemoPopup as jest.Mock).mockReset();
    (paymentLog.debug as jest.Mock).mockClear();
    (paymentLog.info as jest.Mock).mockClear();
    (paymentLog.warn as jest.Mock).mockClear();
    (paymentLog.error as jest.Mock).mockClear();
    useContactSendStore.setState({ active: null });
  });

  it('opens scanned npubs in the modal profile flow', () => {
    // @ts-expect-error openProfile only reads no machine methods.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({
      machine,
      getManager: () => null,
    });

    expect(handlers.openProfile).toBeDefined();
    void handlers.openProfile?.({ npub: 'npub1abc' });

    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/(profile-flow)/profile',
      params: { npub: 'npub1abc' },
    });
  });

  it('stores a Near Pay amount entry inline instead of navigating to the amount route', async () => {
    mockNearPayActive = {
      id: 'near-pay-1',
      startedAt: 1,
      phase: 'picking',
      presentation: 'radar',
      amountEntry: null,
      recipient: {
        peerID: 'peer-123',
        nickname: 'Nearby Alice',
        hasDirectLink: true,
        lastSeen: 2,
      },
    };
    // @ts-expect-error enterAmount only reads no machine methods.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({
      machine,
      getManager: () => null,
    });

    await handlers.enterAmount?.({
      unit: 'sat',
      preselectedMintUrl: 'https://mint.example',
      constraints: {
        destination: 'sendEcash',
        recipientProfile: { displayName: 'Nearby Alice', avatarUrl: null, nip05: null },
      },
    });

    expect(mockNearPaySetAmountEntry).toHaveBeenCalledTimes(1);
    const amountEntry = JSON.parse(mockNearPaySetAmountEntry.mock.calls[0][0] as string);
    expect(amountEntry).toMatchObject({
      destination: 'sendEcash',
      selectedMintUrl: 'https://mint.example',
      unit: 'sat',
      recipientProfile: { displayName: 'Nearby Alice', avatarUrl: null, nip05: null },
    });
    expect(mockNavigate).not.toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/(send-flow)/amount' })
    );
  });

  // The amount step is inline on the radar, so nothing pushes the mint picker
  // off the stack. Left there it covers the radar and every further tap on a
  // mint re-selects into a step the user cannot see.
  it('pops the mint picker off the radar once a Near Pay mint is chosen', async () => {
    mockNearPayActive = {
      id: 'near-pay-1',
      startedAt: 1,
      phase: 'picking',
      presentation: 'radar',
      amountEntry: null,
      mintPickerOpen: true,
      recipient: { peerID: 'peer-123', nickname: 'Nearby Alice', hasDirectLink: true, lastSeen: 2 },
    };
    // @ts-expect-error enterAmount only reads no machine methods.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({ machine, getManager: () => null });

    await handlers.enterAmount?.({
      unit: 'sat',
      preselectedMintUrl: 'https://mint.example',
      constraints: { destination: 'sendEcash' },
    });

    expect(mockNearPaySetAmountEntry).toHaveBeenCalledTimes(1);
    expect(mockNearPaySetMintPickerOpen).toHaveBeenCalledWith(false);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('leaves the stack alone when no mint picker covers the radar', async () => {
    mockNearPayActive = {
      id: 'near-pay-1',
      startedAt: 1,
      phase: 'picking',
      presentation: 'radar',
      amountEntry: null,
      mintPickerOpen: false,
      recipient: { peerID: 'peer-123', nickname: 'Nearby Alice', hasDirectLink: true, lastSeen: 2 },
    };
    // @ts-expect-error enterAmount only reads no machine methods.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({ machine, getManager: () => null });

    await handlers.enterAmount?.({
      unit: 'sat',
      preselectedMintUrl: 'https://mint.example',
      constraints: { destination: 'sendEcash' },
    });

    expect(mockNearPaySetAmountEntry).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('records that the send mint picker is open, and not the receive one', async () => {
    // @ts-expect-error selectMint only reads no machine methods.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({ machine, getManager: () => null });
    const step = { candidates: [], supportedMintUrls: [], unit: 'sat', mintListItems: [] };

    await handlers.selectMint?.({ ...step, destination: 'sendEcash', scope: 'selected' });
    expect(mockNavigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ pathname: '/(send-flow)/mintSelect' })
    );
    expect(mockNearPaySetMintPickerOpen).toHaveBeenCalledWith(true);

    mockNearPaySetMintPickerOpen.mockReset();
    await handlers.selectMint?.({ ...step, destination: 'mintQuote', scope: 'selected' });
    expect(mockNavigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ pathname: '/(receive-flow)/mintSelect' })
    );
    expect(mockNearPaySetMintPickerOpen).not.toHaveBeenCalled();
  });

  it('keeps normal send amount navigation when Near Pay is inactive', async () => {
    // @ts-expect-error enterAmount only reads no machine methods.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({
      machine,
      getManager: () => null,
    });

    await handlers.enterAmount?.({
      unit: 'sat',
      preselectedMintUrl: 'https://mint.example',
      constraints: { destination: 'sendEcash' },
    });

    expect(mockNearPaySetAmountEntry).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/(send-flow)/amount',
      params: {
        amountEntry: expect.any(String),
      },
    });
  });

  it('serializes the Create Ecash entry source into the amount route', async () => {
    // @ts-expect-error enterAmount only reads no machine methods.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({ machine, getManager: () => null });

    await handlers.enterAmount?.({
      unit: 'sat',
      preselectedMintUrl: 'https://mint.example',
      constraints: { destination: 'sendEcash', entrySource: 'createEcash' },
    });

    const navigation = mockNavigate.mock.calls.find(
      ([value]) => (value as { pathname?: string }).pathname === '/(send-flow)/amount'
    )?.[0] as { params: { amountEntry: string } };
    expect(JSON.parse(navigation.params.amountEntry)).toMatchObject({
      destination: 'sendEcash',
      selectedMintUrl: 'https://mint.example',
      unit: 'sat',
      entrySource: 'createEcash',
    });
  });

  it('carries a P2PK lock marker into the amount route without logging the key', async () => {
    // @ts-expect-error enterAmount only reads no machine methods.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({ machine, getManager: () => null });
    const p2pkLockPubkey = `02${'34'.repeat(32)}`;

    await handlers.enterAmount?.({
      unit: 'sat',
      preselectedMintUrl: 'https://mint.example',
      constraints: { destination: 'sendEcash', p2pkLockPubkey },
    });

    const navigation = mockNavigate.mock.calls.find(
      ([value]) => (value as { pathname?: string }).pathname === '/(send-flow)/amount'
    )?.[0] as { params: { amountEntry: string } };
    expect(JSON.parse(navigation.params.amountEntry)).toMatchObject({ p2pkLockPubkey });
    expect(JSON.stringify(paymentLogCalls())).not.toContain(p2pkLockPubkey);
  });

  it('carries a P2PK lock marker into the send-token route without logging it', async () => {
    // @ts-expect-error sendComplete only reads getContext.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({ machine, getManager: () => null });
    const p2pkLockPubkey = `02${'12'.repeat(32)}`;
    await handlers.sendComplete?.({
      historyEntry: JSON.stringify({
        id: 'send-p2pk-e2e',
        type: 'send',
        mintUrl: 'https://mint.example',
        token: { mint: 'https://mint.example', proofs: [] },
      }),
      p2pkLockPubkey,
    });

    const navigation = mockNavigate.mock.calls.find(
      ([value]) => (value as { pathname?: string }).pathname === '/(send-flow)/sendToken'
    )?.[0] as { params: { sendHistoryEntry: string } };
    expect(JSON.parse(navigation.params.sendHistoryEntry)).toMatchObject({
      metadata: { p2pkLockPubkey },
    });
    expect(paymentLog.info).toHaveBeenCalledWith(
      'payment.step.send_complete',
      expect.objectContaining({ p2pkLocked: true })
    );
    expect(JSON.stringify(paymentLogCalls())).not.toContain(p2pkLockPubkey);
  });

  it('waits for contact DM delivery before opening the thread and clears the target', async () => {
    const recipientPubkey = 'ab'.repeat(32);
    const bearerToken = 'cashuA-private-contact-token';
    useContactSendStore
      .getState()
      .start({ pubkey: recipientPubkey, displayName: 'Alice', delivery: 'nip17' });

    let markDeliveryStarted!: () => void;
    let releaseDelivery!: () => void;
    const deliveryStarted = new Promise<void>((resolve) => {
      markDeliveryStarted = resolve;
    });
    const deliveryPending = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const deliverContactEcashDm = jest.fn(() => {
      markDeliveryStarted();
      return deliveryPending;
    });
    // @ts-expect-error sendComplete only reads getContext.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({
      machine,
      getManager: () => null,
      deliverContactEcashDm,
    });

    const sendComplete = handlers.sendComplete?.({
      historyEntry: JSON.stringify({
        id: 'send-contact-success',
        type: 'send',
        mintUrl: 'https://mint.example',
        tokenString: bearerToken,
      }),
      createdOffline: false,
      mintWasOffline: false,
    });
    await deliveryStarted;

    expect(deliverContactEcashDm).toHaveBeenCalledWith({ recipientPubkey, token: bearerToken });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(useContactSendStore.getState().active).not.toBeNull();

    releaseDelivery();
    await sendComplete;

    expect(mockDismissAll).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/userMessages',
      params: { pubkey: recipientPubkey },
    });
    expect(useContactSendStore.getState().active).toBeNull();
    expect(mockDismissAll.mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigate.mock.invocationCallOrder[0]
    );
    expect(JSON.stringify(paymentLogCalls())).not.toContain(bearerToken);
  });

  it('still DMs a LOCKED token to the contact it was locked to', async () => {
    // Regression: sendComplete read "has a P2PK lock" as "this was a Nut Drop",
    // so a locked contact send skipped the DM and dropped the user on the
    // bearer hand-off screen instead of the thread.
    const recipientPubkey = 'ef'.repeat(32);
    const lockedToken = 'cashuA-locked-contact-token';
    useContactSendStore
      .getState()
      .start({ pubkey: recipientPubkey, displayName: 'Dave', delivery: 'nip17' });
    const deliverContactEcashDm = jest.fn(async () => {});
    // @ts-expect-error sendComplete only reads getContext.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({
      machine,
      getManager: () => null,
      deliverContactEcashDm,
    });

    await handlers.sendComplete?.({
      historyEntry: JSON.stringify({
        id: 'send-contact-locked',
        type: 'send',
        mintUrl: 'https://mint.example',
        tokenString: lockedToken,
      }),
      createdOffline: false,
      mintWasOffline: false,
      recipientPubkey,
      p2pkLockPubkey: `02${'34'.repeat(32)}`,
      p2pkLock: {
        pubkey: `02${'34'.repeat(32)}`,
        locktimeSec: 1_800_003_600,
        refundKeys: [`02${'56'.repeat(32)}`],
      },
    });

    expect(deliverContactEcashDm).toHaveBeenCalledWith({
      recipientPubkey,
      token: lockedToken,
    });
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/userMessages',
      params: { pubkey: recipientPubkey },
    });
  });

  it('keeps the contact target and opens bearer hand-off when DM delivery fails', async () => {
    const recipientPubkey = 'cd'.repeat(32);
    const bearerToken = 'cashuA-recoverable-contact-token';
    useContactSendStore
      .getState()
      .start({ pubkey: recipientPubkey, displayName: 'Carol', delivery: 'nip17' });
    const deliverContactEcashDm = jest.fn(async () => {
      throw new Error('relay unavailable');
    });
    // @ts-expect-error sendComplete only reads getContext.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({
      machine,
      getManager: () => null,
      deliverContactEcashDm,
    });

    await handlers.sendComplete?.({
      historyEntry: JSON.stringify({
        id: 'send-contact-fallback',
        type: 'send',
        mintUrl: 'https://mint.example',
        tokenString: bearerToken,
      }),
      createdOffline: false,
      mintWasOffline: false,
    });

    expect(useContactSendStore.getState().active).toMatchObject({ pubkey: recipientPubkey });
    expect(mockDismissAll).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/(send-flow)/sendToken',
      params: expect.objectContaining({
        sendHistoryEntry: expect.stringContaining('send-contact-fallback'),
      }),
    });
    expect(JSON.stringify(paymentLogCalls())).not.toContain(bearerToken);
  });

  it('opens the ecash memo sheet without submitting the memo on display', () => {
    const submitSendMemo = jest.fn();
    const machine = {
      getContext: jest.fn(() => ({})),
      submitSendMemo,
    } as unknown as PaymentMachine;
    const handlers = createSovranHandlers({
      machine,
      getManager: () => null,
    });

    void handlers.enterSendMemo?.({
      mintUrl: 'https://mint.example',
      amount: 21,
      unit: 'sat',
      memo: 'coffee',
    });

    expect(sendMemoPopup).toHaveBeenCalledWith({
      mintUrl: 'https://mint.example',
      amount: 21,
      unit: 'sat',
      memo: 'coffee',
      machine,
    });
    expect(submitSendMemo).not.toHaveBeenCalled();
  });

  it('routes a nearby Send selection to a visible amount screen', async () => {
    mockNearPayActive = {
      id: 'nearby-route',
      presentation: 'route',
      recipient: { peerID: 'peer' },
    };
    // @ts-expect-error enterAmount only reads no machine methods.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({ machine, getManager: () => null });
    await handlers.enterAmount?.({
      unit: 'sat',
      constraints: { destination: 'sendEcash', p2pkLockPubkey: `02${'ab'.repeat(32)}` },
    });
    expect(mockNearPaySetAmountEntry).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/(send-flow)/amount',
      params: { amountEntry: expect.any(String) },
    });
    expect(JSON.parse(mockNavigate.mock.calls[0][0].params.amountEntry).p2pkLockPubkey).toBe(
      `02${'ab'.repeat(32)}`
    );
  });

  it('keeps the created token recoverable without completing an unrelated nearby session', async () => {
    mockNearPayActive = {
      id: 'different-selection',
      presentation: 'route',
      recipient: { peerID: 'other-peer' },
    };
    (getEncodedToken as jest.Mock).mockReturnValue('cashuA-created-token');
    // @ts-expect-error sendComplete only reads no machine methods.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({ machine, getManager: () => null });
    await handlers.sendComplete?.({
      historyEntry: JSON.stringify({
        id: 'send-1',
        type: 'send',
        mintUrl: 'https://mint.example',
        token: { mint: 'https://mint.example', proofs: [] },
      }),
      createdOffline: false,
      mintWasOffline: false,
    });
    expect(mockNearPayComplete).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('skips P2PK key regeneration when the current-profile P2PK plugin is active', async () => {
    const generateKeyPair = jest.fn();
    const getLatestKeyPair = jest.fn();
    const onP2pkKeyRefreshed = jest.fn();
    (useSettingsStore.getState as jest.Mock).mockReturnValue({
      regenerateP2PKOnReceive: true,
    });

    const manager = {
      ext: { p2pkImport: { getPublicKeys: () => [`02${'44'.repeat(32)}`] } },
      keyring: { generateKeyPair, getLatestKeyPair },
    };
    const notifications = createSovranNotifications({
      getManager: () => manager as unknown as Manager,
      onP2pkKeyRefreshed,
    });

    await notifications.onP2PKReceiveCompleted?.({
      transactionId: 'tx-current-profile-p2pk',
      mintUrl: 'https://mint.example.com',
      hadP2PKProofs: true,
    });

    expect(generateKeyPair).not.toHaveBeenCalled();
    expect(getLatestKeyPair).not.toHaveBeenCalled();
    expect(onP2pkKeyRefreshed).not.toHaveBeenCalled();
  });

  it('keeps regenerating P2PK keys after receive when no current-profile P2PK plugin key is active', async () => {
    const nextPublicKey = `02${'33'.repeat(32)}`;
    const generateKeyPair = jest.fn(async () => ({ publicKeyHex: nextPublicKey }));
    const getLatestKeyPair = jest.fn(async () => ({ publicKeyHex: nextPublicKey }));
    const onP2pkKeyRefreshed = jest.fn();
    (useSettingsStore.getState as jest.Mock).mockReturnValue({
      regenerateP2PKOnReceive: true,
    });

    const manager = {
      ext: {},
      keyring: { generateKeyPair, getLatestKeyPair },
    };
    const notifications = createSovranNotifications({
      getManager: () => manager as unknown as Manager,
      onP2pkKeyRefreshed,
    });

    await notifications.onP2PKReceiveCompleted?.({
      transactionId: 'tx-rotating-p2pk',
      mintUrl: 'https://mint.example.com',
      hadP2PKProofs: true,
    });

    expect(generateKeyPair).toHaveBeenCalledTimes(1);
    expect(onP2pkKeyRefreshed).toHaveBeenCalledWith(nextPublicKey);
  });
});

it('shows the NFC unfunded-unit explanation from the wallet', () => {
  const message = 'This terminal wants USD. You have no USD ecash at an accepted mint.';
  void createSovranNotifications().UNIT_NOT_FUNDED?.({ code: 'UNIT_NOT_FUNDED', message });
  expect(paramPopup).toHaveBeenCalledWith('nfc-error', {
    title: 'Currency unavailable',
    message,
  });
});
