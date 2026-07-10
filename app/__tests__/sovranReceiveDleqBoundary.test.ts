/**
 * @jest-environment node
 */

import { Amount, type Proof } from '@cashu/cashu-ts';

import { createSovranExecuteReceive } from '@/features/send/lib/sovranPaymentConfig';
import { requirePreparedOfflineReceiveDleq } from '@/shared/lib/cashu/offlineReceiveDleq';

jest.mock('wallet', () => ({
  classifyMeshRedeemError: jest.fn(() => 'network'),
  withTimeout: jest.fn((promise: Promise<unknown>) => promise),
  rawAnnotationKey: jest.fn((raw: string) => `raw:${raw}`),
}));

jest.mock('@/shared/lib/cashu/offlineReceiveDleq', () => ({
  requirePreparedOfflineReceiveDleq: jest.fn(),
}));

jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { navigate: jest.fn(), replace: jest.fn(), dismiss: jest.fn() },
}));
jest.mock('expo-camera', () => ({ scanFromURLAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('react-native', () => ({ Share: { share: jest.fn() } }));
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
  isAmbientNfcCycle: jest.fn(() => false),
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
  useRoutstrTopUpStore: { getState: jest.fn(() => ({ active: false })) },
}));
jest.mock('@/shared/stores/runtime/nearPayStore', () => ({
  useNearPaySessionStore: { getState: jest.fn(() => ({ active: null })) },
}));
jest.mock('@/shared/stores/runtime/contactSendStore', () => ({
  useContactSendStore: { getState: jest.fn(() => ({ active: false })) },
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
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: jest.fn(),
  linkTransactionAnnotation: jest.fn(),
  setDistributionAnnotation: jest.fn(),
}));
jest.mock('@/shared/stores/profile/sendReachabilityStore', () => ({
  useSendReachabilityStore: {
    getState: jest.fn(() => ({ markChecking: jest.fn(), pruneOld: jest.fn() })),
  },
}));
jest.mock('@/shared/stores/profile/transactionDistributionStore', () => ({
  useTransactionDistributionStore: { getState: jest.fn(() => ({})) },
}));

const mockedRequireDleq = jest.mocked(requirePreparedOfflineReceiveDleq);
const MINT_URL = 'https://mint.example';

function receiveManager() {
  const proof: Proof = {
    id: '00',
    amount: Amount.from(1),
    C: `02${'1'.repeat(64)}`,
    secret: 'offline-proof',
  };
  const prepared = {
    id: 'receive-op',
    state: 'prepared',
    mintUrl: MINT_URL,
    unit: 'sat',
    amount: Amount.from(1),
    inputProofs: [proof],
    fee: Amount.from(0),
    outputData: { keep: [], send: [] },
    createdAt: 1,
    updatedAt: 1,
  };
  const manager = Object.assign(Object.create(null), {
    history: {
      getPaginatedHistory: jest.fn().mockResolvedValue([]),
    },
    ops: {
      receive: {
        prepare: jest.fn().mockResolvedValue(prepared),
        execute: jest.fn().mockRejectedValue(new Error('network unavailable')),
        get: jest.fn().mockResolvedValue({ ...prepared, state: 'executing' }),
      },
    },
  });
  return { manager, prepared };
}

describe('Sovran receive operation DLEQ integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not return the offline pending state until DLEQ verification succeeds', async () => {
    const { manager, prepared } = receiveManager();
    mockedRequireDleq.mockResolvedValue();
    const executeReceive = createSovranExecuteReceive(() => manager);

    await expect(
      executeReceive('invalid-token-for-metadata-only', MINT_URL, 1)
    ).resolves.toMatchObject({ status: 'pending', operationId: 'receive-op' });
    expect(mockedRequireDleq).toHaveBeenCalledWith(manager, prepared);
    expect(mockedRequireDleq.mock.invocationCallOrder[0]).toBeLessThan(
      manager.ops.receive.execute.mock.invocationCallOrder[0]
    );
  });

  it('rejects offline acceptance when the DLEQ boundary rejects the proofs', async () => {
    const { manager, prepared } = receiveManager();
    const verificationError = new Error('offline verification rejected');
    mockedRequireDleq.mockRejectedValue(verificationError);
    const executeReceive = createSovranExecuteReceive(() => manager);

    await expect(executeReceive('invalid-token-for-metadata-only', MINT_URL, 1)).rejects.toBe(
      verificationError
    );
    expect(mockedRequireDleq).toHaveBeenCalledWith(manager, prepared);
  });

  it('rejects before execute when the device is already offline', async () => {
    const { manager, prepared } = receiveManager();
    const verificationError = new Error('offline verification rejected');
    mockedRequireDleq.mockRejectedValue(verificationError);
    const executeReceive = createSovranExecuteReceive(
      () => manager,
      () => true
    );

    await expect(executeReceive('invalid-token-for-metadata-only', MINT_URL, 1)).rejects.toBe(
      verificationError
    );
    expect(mockedRequireDleq).toHaveBeenCalledWith(manager, prepared);
    expect(manager.ops.receive.execute).not.toHaveBeenCalled();
  });
});
