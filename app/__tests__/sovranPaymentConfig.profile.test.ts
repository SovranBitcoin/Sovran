/**
 * @jest-environment node
 */

import type { PaymentMachine } from 'wallet';
import type { Manager } from '@cashu/coco-core';
import {
  createSovranHandlers,
  createSovranNotifications,
} from '@/features/send/lib/sovranPaymentConfig';
import { sendMemoPopup } from '@/shared/lib/popup';
import { getEncodedToken } from '@cashu/cashu-ts';
import { sendBLEPrivateMessageWhole } from '@/features/bitchat/lib/blePrivateDelivery';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { paymentLog } from '@/shared/lib/logger';

const mockNavigate = jest.fn();
const mockNearPayComplete = jest.fn();
const mockNearPaySetAmountEntry = jest.fn();
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
    replace: jest.fn(),
    dismiss: jest.fn(),
  },
  useSegments: jest.fn(() => []),
}));

jest.mock('expo-camera', () => ({ scanFromURLAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('react-native', () => ({ Share: { share: jest.fn() } }));
jest.mock('@cashu/cashu-ts', () => ({ getDecodedToken: jest.fn(), getEncodedToken: jest.fn() }));
jest.mock('@/features/bitchat/lib/blePrivateDelivery', () => ({
  sendBLEPrivateMessageWhole: jest.fn(),
}));
jest.mock('@/features/bitchat/hooks/useBitchatNickname', () => ({
  getBitchatNickname: jest.fn(() => 'Self Sender'),
}));
jest.mock('@/features/bitchat/lib/profileScope', () => ({
  getBitchatProfileScope: jest.fn(() => 'profile-scope'),
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
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
  useRoutstrTopUpStore: { getState: jest.fn(() => ({ active: false, complete: jest.fn() })) },
}));
jest.mock('@/shared/stores/runtime/nearPayStore', () => ({
  useNearPaySessionStore: {
    getState: jest.fn(() => ({
      active: mockNearPayActive,
      complete: mockNearPayComplete,
      setAmountEntry: mockNearPaySetAmountEntry,
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
    mockNearPayComplete.mockReset();
    mockNearPaySetAmountEntry.mockReset();
    mockNearPayActive = null;
    (getEncodedToken as jest.Mock).mockReset();
    (sendBLEPrivateMessageWhole as jest.Mock).mockReset();
    (sendMemoPopup as jest.Mock).mockReset();
    (paymentLog.debug as jest.Mock).mockClear();
    (paymentLog.info as jest.Mock).mockClear();
    (paymentLog.warn as jest.Mock).mockClear();
    (paymentLog.error as jest.Mock).mockClear();
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
        token: { proofs: [] },
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

  it('does not DM a token when the recipient has no creq capability proof', async () => {
    mockNearPayActive = {
      id: 'near-pay-no-creq',
      startedAt: 1,
      recipient: {
        peerID: 'peer-no-creq',
        nickname: 'Unconfirmed Carol',
        hasDirectLink: true,
        lastSeen: 2,
        delivery: { locked: false },
      },
    };
    (getEncodedToken as jest.Mock).mockReturnValue('cashuA-token-that-must-not-send');
    // @ts-expect-error sendComplete only reads no machine methods.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({
      machine,
      getManager: () => null,
    });
    const historyEntry = JSON.stringify({
      id: 'send-no-creq',
      type: 'send',
      mintUrl: 'https://mint.example',
      token: { proofs: [] },
    });

    await handlers.sendComplete?.({
      historyEntry,
      createdOffline: false,
      mintWasOffline: false,
    });

    expect(sendBLEPrivateMessageWhole).not.toHaveBeenCalled();
    expect(mockNearPayComplete).toHaveBeenCalledTimes(1);
  });

  it('DMs an offline bearer token to a creq-confirmed peer', async () => {
    mockNearPayActive = {
      id: 'near-pay-3',
      startedAt: 1,
      recipient: {
        peerID: 'peer-789',
        nickname: 'Sovran Carol',
        hasDirectLink: true,
        lastSeen: 2,
        creq: 'creqA-confirmed',
        delivery: { locked: false },
      },
    };
    (getEncodedToken as jest.Mock).mockReturnValue('cashuA-bearer-token');
    (sendBLEPrivateMessageWhole as jest.Mock).mockResolvedValue({
      messageId: 'm',
      startupMs: 1,
      handshakeMs: 2,
      sendMs: 3,
    });
    // @ts-expect-error sendComplete only reads no machine methods.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({
      machine,
      getManager: () => null,
    });
    const historyEntry = JSON.stringify({
      id: 'send-3',
      type: 'send',
      mintUrl: 'https://mint.example',
      token: { proofs: [] },
    });

    // Bearer drops take the local-proof shortcut when offline, but only after a
    // valid creq confirmed the recipient can decode extended private DMs.
    await handlers.sendComplete?.({
      historyEntry,
      createdOffline: true,
      mintWasOffline: true,
    });

    expect(sendBLEPrivateMessageWhole).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'cashuA-bearer-token', peerID: 'peer-789' })
    );
    expect(mockNearPayComplete).toHaveBeenCalledTimes(1);
  });

  it('DMs a locked token privately to the recipient peer', async () => {
    mockNearPayActive = {
      id: 'near-pay-4',
      startedAt: 1,
      recipient: {
        peerID: 'peer-999',
        nickname: 'Sovran Dave',
        hasDirectLink: true,
        lastSeen: 2,
        creq: 'creqA-confirmed',
        delivery: { locked: true },
      },
    };
    (getEncodedToken as jest.Mock).mockReturnValue('cashuA-locked-token');
    (sendBLEPrivateMessageWhole as jest.Mock).mockResolvedValue({
      messageId: 'm',
      startupMs: 1,
      handshakeMs: 2,
      sendMs: 3,
    });
    // @ts-expect-error sendComplete only reads no machine methods.
    const machine: PaymentMachine = { getContext: jest.fn(() => ({})) };
    const handlers = createSovranHandlers({
      machine,
      getManager: () => null,
    });
    const historyEntry = JSON.stringify({
      id: 'send-4',
      type: 'send',
      mintUrl: 'https://mint.example',
      token: { proofs: [] },
    });

    // A locked token is delivered as a private Noise DM addressed to the
    // recipient peer — encrypted to them, so the payment stays private and
    // only they can redeem the P2PK-locked proofs.
    await handlers.sendComplete?.({
      historyEntry,
      createdOffline: false,
      mintWasOffline: false,
      p2pkLockPubkey: `02${'ef'.repeat(32)}`,
    });

    expect(sendBLEPrivateMessageWhole).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'cashuA-locked-token', peerID: 'peer-999' })
    );
    expect(mockNearPayComplete).toHaveBeenCalledTimes(1);
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
