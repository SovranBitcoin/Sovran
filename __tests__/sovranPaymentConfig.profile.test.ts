/**
 * @jest-environment node
 */

import type { PaymentMachine } from 'coco-payment-ux';
import {
  createSovranHandlers,
  createSovranNotifications,
} from '@/features/send/lib/sovranPaymentConfig';
import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import { sendBLEPrivateMessageChunks } from '@/features/bitchat/lib/blePrivateDelivery';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

const mockNavigate = jest.fn();
const mockNearPayComplete = jest.fn();
const mockNearPaySetAmountEntry = jest.fn();
let mockNearPayActive: unknown = null;

jest.mock('coco-payment-ux', () => ({
  withTimeout: jest.fn((promise: Promise<unknown>) => promise),
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
jest.mock('@cashu/cashu-ts', () => ({ getDecodedToken: jest.fn(), getEncodedTokenV4: jest.fn() }));
jest.mock('@/features/bitchat/lib/blePrivateDelivery', () => ({
  sendBLEPrivateMessageChunks: jest.fn(),
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
    (getEncodedTokenV4 as jest.Mock).mockReset();
    (sendBLEPrivateMessageChunks as jest.Mock).mockReset();
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

  it('delivers an active Near Pay token over BitChat before showing the send token screen', async () => {
    mockNearPayActive = {
      id: 'near-pay-1',
      startedAt: 1,
      recipient: {
        peerID: 'peer-123',
        nickname: 'Nearby Alice',
        hasDirectLink: true,
        lastSeen: 2,
      },
    };
    (getEncodedTokenV4 as jest.Mock).mockReturnValue('cashuA-near-pay-token');
    (sendBLEPrivateMessageChunks as jest.Mock).mockResolvedValue({
      chunks: 2,
      messageIds: ['m-1', 'm-2'],
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
      id: 'send-1',
      type: 'send',
      mintUrl: 'https://mint.example',
      token: { proofs: [] },
    });

    await handlers.sendComplete?.({
      historyEntry,
      createdOffline: false,
      mintWasOffline: false,
    });

    expect(sendBLEPrivateMessageChunks).toHaveBeenCalledWith(
      expect.objectContaining({
        peerID: 'peer-123',
        content: 'cashuA-near-pay-token',
        nickname: 'Self Sender',
        profileScope: 'profile-scope',
        messageIdPrefix: 'near-pay',
      })
    );
    expect(mockNearPayComplete).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/(send-flow)/sendToken',
      params: { sendHistoryEntry: historyEntry },
    });
  });

  it('skips P2PK key regeneration when the current-profile P2PK plugin is active', async () => {
    const generateKeyPair = jest.fn();
    const getLatestKeyPair = jest.fn();
    const onP2pkKeyRefreshed = jest.fn();
    (useSettingsStore.getState as jest.Mock).mockReturnValue({
      regenerateP2PKOnReceive: true,
    });

    const notifications = createSovranNotifications({
      getManager: () =>
        ({
          ext: { p2pkImport: { getPublicKeys: () => [`02${'44'.repeat(32)}`] } },
          keyring: { generateKeyPair, getLatestKeyPair },
        }) as never,
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

    const notifications = createSovranNotifications({
      getManager: () =>
        ({
          ext: {},
          keyring: { generateKeyPair, getLatestKeyPair },
        }) as never,
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
