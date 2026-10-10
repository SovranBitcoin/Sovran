/** @jest-environment node */
import { Amount, PaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts';
import type { Manager } from '@cashu/coco-core';
import { nprofileEncode } from 'nostr-tools/nip19';
import {
  captureNearbyDelivery,
  nearbyPayments,
  NEARBY_PAYMENT_PREFIX,
} from '@/features/nearPay/lib/nearbyPayments';

const mockStorage = new Map<string, string>();
let mockManager: Manager;
let mockOwner = 'profile-a';
let mockPeer: Record<string, unknown>;
let mockActive: Record<string, unknown> | null;
const mockNostr = jest.fn();
const mockBle = jest.fn();
const mockComplete = jest.fn();
const mockAnnotations = new Map<string, unknown>();
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: (id: string, annotation: unknown) =>
    mockAnnotations.set(id, annotation),
}));
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({
  readProfileRecord: () => ({ picture: 'https://profile.example/avatar.png' }),
}));
let mockListener: ((event: { messageID: string; status: string }) => void) | undefined;
let mockFailWrite = false;
jest.mock('@/shared/lib/persist/secureVault', () => ({
  createSecureVault: (owner: string, name: string) => ({
    read: async () => mockStorage.get(`${owner}:${name}`) ?? null,
    write: async (value: string) => {
      if (mockFailWrite) {
        mockFailWrite = false;
        throw new Error('storage unavailable');
      }
      mockStorage.set(`${owner}:${name}`, value);
    },
  }),
}));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { isInitialized: () => true, getInstance: () => mockManager },
}));
jest.mock('@/features/bitchat/lib/profileScope', () => ({
  getBitchatProfileScope: () => mockOwner,
}));
jest.mock('@/features/bitchat/hooks/useBLEPeers', () => ({
  useBLEPeerDirectory: { getState: () => ({ peers: [mockPeer] }) },
}));
jest.mock('@/shared/stores/runtime/nearPayStore', () => ({
  useNearPaySessionStore: { getState: () => ({ active: mockActive, complete: mockComplete }) },
}));
jest.mock('@/shared/stores/global/walletLifecycleStore', () => ({
  useWalletLifecycleStore: { getState: () => ({ restoreStatus: 'complete' }) },
}));
const mockPrepareNostr = jest.fn();
jest.mock('@/shared/lib/nostr/sendDirectMessage', () => ({
  ...jest.requireActual('@/shared/lib/nostr/sendDirectMessage'),
  sendDirectMessageToRelays: {
    prepare: (...args: unknown[]) => mockPrepareNostr(...args),
    publish: (...args: unknown[]) => mockNostr(...args),
  },
}));
jest.mock('@/shared/lib/cashu/offlineReceiveDleq', () => ({ requireOfflineTokenDleq: jest.fn() }));
jest.mock('bitchat-module', () => ({
  addBLEDeliveryStatusListener: (listener: typeof mockListener) => {
    mockListener = listener;
    return {
      remove: () => {
        mockListener = undefined;
      },
    };
  },
  sendBLEPrivateMessage: (...args: unknown[]) => mockBle(...args),
}));
const pubkey = 'ab'.repeat(32);
const mint = 'https://mint.example';
const identity = {
  version: 'sovran-bitchat-ble-v1' as const,
  nostrPubkey: pubkey,
  noisePrivateKeyHex: '01'.repeat(32),
  signingPrivateKeyHex: '02'.repeat(32),
};
const creq = new PaymentRequest(
  [{ type: PaymentRequestTransportType.NOSTR, target: nprofileEncode({ pubkey }) }],
  'request-a',
  undefined,
  'sat',
  [mint],
  undefined,
  false,
  { kind: 'P2PK', data: `02${pubkey}`, tags: [] }
).toEncodedRequest();
const token = {
  mint,
  unit: 'sat',
  proofs: [
    {
      id: '00'.repeat(8),
      amount: Amount.from(1),
      secret: 'test-secret',
      C: '02' + 'cd'.repeat(32),
    },
  ],
};
function manager() {
  return {
    mint: { isTrustedMint: jest.fn(async () => true) },
    recoverPendingPaymentRequestReceiveAttempts: jest.fn(async () => undefined),
    paymentRequests: {
      incoming: {
        list: jest.fn(async () => [{ requestId: 'request-a', mints: [mint] }]),
        ingestPayload: jest.fn(async () => ({
          attempt: {
            state: 'finalized',
            receiveOperationId: 'receive-a',
            transport: 'inband',
            transportMessageId: 'ble:payload',
          },
        })),
      },
    },
    ops: { send: { get: jest.fn(async () => ({ id: 'send-a', state: 'pending', token })) } },
  } as unknown as Manager;
}
beforeEach(() => {
  mockStorage.clear();
  mockAnnotations.clear();
  mockFailWrite = false;
  mockPrepareNostr.mockReset();
  mockPrepareNostr.mockImplementation(async ({ message }) => ({
    event: {
      id: '1'.repeat(64),
      pubkey: '2'.repeat(64),
      sig: '3'.repeat(128),
      kind: 1059,
      created_at: 1,
      tags: [],
      content: message,
    },
    relays: ['wss://relay.example'],
  }));
  mockNostr.mockReset();
  mockBle.mockReset();
  mockComplete.mockReset();
  mockOwner = 'profile-a';
  mockManager = manager();
  mockPeer = {
    peerID: 'peer-a',
    nostrPubkeyHex: pubkey,
    creq,
    walletCapabilityExpiresAt: Date.now() + 120_000,
  };
  mockActive = { id: 'session-a', recipient: mockPeer };
  mockNostr.mockResolvedValue(undefined);
  mockBle.mockImplementation(async (_peer, _content, _name, id: string) => {
    mockListener?.({ messageID: id, status: 'delivered' });
  });
});

it('recovers an operation-bound intent and sends identical NUT-18 bytes over both transports', async () => {
  const bind = captureNearbyDelivery({
    manager: mockManager,
    mintUrl: mint,
    lockPubkey: `02${pubkey}`,
  });
  expect(bind).toBeDefined();
  await bind!('send-a');
  // Restart after execution, before payload persistence. The operation and its
  // original recipient survive; a new UI session must not redirect the token.
  mockManager = manager();
  mockActive = { id: 'new-session', recipient: { ...mockPeer, peerID: 'other-peer' } };
  await nearbyPayments(mockManager).drain(new Uint8Array(32).fill(1), identity, 'Alice');
  const bleContent = mockBle.mock.calls[0][1];
  const nostrContent = mockNostr.mock.calls[0][0].event.content;
  expect(bleContent).toBe(NEARBY_PAYMENT_PREFIX + nostrContent);
  expect(JSON.parse(nostrContent)).toMatchObject({
    id: 'request-a',
    mint,
    unit: 'sat',
    proofs: [{ amount: 1, secret: 'test-secret' }],
  });
  expect(mockBle.mock.calls[0][0]).toBe('peer-a');
  expect(mockComplete).not.toHaveBeenCalled();
});

it('retains the same payload after transport failure and never creates a second send', async () => {
  await captureNearbyDelivery({ manager: mockManager, mintUrl: mint, lockPubkey: `02${pubkey}` })!(
    'send-a'
  );
  mockBle.mockRejectedValueOnce(new Error('offline'));
  mockNostr.mockRejectedValueOnce(new Error('offline'));
  await nearbyPayments(mockManager).drain(new Uint8Array(32).fill(1), identity, 'Alice');
  expect(mockComplete).not.toHaveBeenCalled();
  const first = mockNostr.mock.calls[0][0].event.content;
  const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
  try {
    await nearbyPayments(mockManager).drain(new Uint8Array(32).fill(1), identity, 'Alice');
    expect(mockNostr.mock.calls[1][0].event.content).toBe(first);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockPrepareNostr).toHaveBeenCalledTimes(1);
    expect(mockNostr.mock.calls[1][0]).toEqual(mockNostr.mock.calls[0][0]);
  } finally {
    now.mockRestore();
  }
});

it('stops a stale profile before either transport publishes', async () => {
  await captureNearbyDelivery({ manager: mockManager, mintUrl: mint, lockPubkey: `02${pubkey}` })!(
    'send-a'
  );
  const service = nearbyPayments(mockManager);
  mockOwner = 'profile-b';
  await service.drain(new Uint8Array(32).fill(1), identity, 'Alice');
  expect(mockBle).not.toHaveBeenCalled();
  expect(mockNostr).not.toHaveBeenCalled();
});

function incomingPayload() {
  return JSON.stringify({
    id: 'request-a',
    mint,
    unit: 'sat',
    proofs: [
      {
        ...token.proofs[0],
        amount: 1,
        secret: JSON.stringify(['P2PK', { nonce: 'n', data: `02${pubkey}`, tags: [] }]),
      },
    ],
  });
}

it('retains rejected payment bytes across restart without claiming them again', async () => {
  const rejectedResult = { attempt: { id: 'attempt-a', state: 'rejected' } };
  jest
    .mocked(mockManager.paymentRequests.incoming.ingestPayload)
    .mockResolvedValue(rejectedResult as never);
  const payload = incomingPayload();
  await nearbyPayments(mockManager).ingest(payload, pubkey);
  await nearbyPayments(mockManager).drain(new Uint8Array(32).fill(1), identity, 'Alice');
  const journal = JSON.parse(mockStorage.get('profile-a:nearby-payment-journal')!);
  expect(Object.values(journal.inbound)).toEqual([{ payload, rejected: true }]);
  mockManager = manager();
  await nearbyPayments(mockManager).drain(new Uint8Array(32).fill(1), identity, 'Alice');
  expect(mockManager.paymentRequests.incoming.ingestPayload).not.toHaveBeenCalled();
});

it('refuses invalid radio input before it occupies durable inbox capacity', async () => {
  const payload = JSON.stringify({
    id: 'request-a',
    mint,
    unit: 'sat',
    proofs: [{ ...token.proofs[0], amount: 1 }],
  });
  await expect(nearbyPayments(mockManager).ingest(payload, pubkey)).rejects.toThrow('not locked');
  expect(mockStorage.size).toBe(0);
  const valid = incomingPayload();
  await nearbyPayments(mockManager).ingest(valid, pubkey);
  await nearbyPayments(mockManager).drain(new Uint8Array(32).fill(1), identity, 'Alice');
  expect(mockManager.paymentRequests.incoming.ingestPayload).toHaveBeenCalledWith(
    valid,
    expect.objectContaining({ transport: 'inband' })
  );
});

it('resumes an existing delivery after a later journal write fails', async () => {
  await captureNearbyDelivery({ manager: mockManager, mintUrl: mint, lockPubkey: `02${pubkey}` })!(
    'send-a'
  );
  mockFailWrite = true;
  await expect(nearbyPayments(mockManager).ingest(incomingPayload(), pubkey)).rejects.toThrow(
    'storage unavailable'
  );
  await nearbyPayments(mockManager).drain(new Uint8Array(32).fill(1), identity, 'Alice');
  expect(mockNostr.mock.calls[0][0].event.content).toContain('"id":"request-a"');
});

it('keeps outbound delivery and retries moving while inbound mint recovery is stalled', async () => {
  let resumeRecovery!: () => void;
  const recovery = new Promise<void>((resolve) => {
    resumeRecovery = resolve;
  });
  jest.mocked(mockManager.recoverPendingPaymentRequestReceiveAttempts).mockReturnValue(recovery);
  await captureNearbyDelivery({ manager: mockManager, mintUrl: mint, lockPubkey: `02${pubkey}` })!(
    'send-a'
  );
  const service = nearbyPayments(mockManager);
  await service.ingest(incomingPayload(), pubkey);
  const first = service.drain(new Uint8Array(32).fill(1), identity, 'Alice');
  let second: Promise<void> | undefined;
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  try {
    // Every other boundary is resolved; yield the microtask queue while the mint stays blocked.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mockBle).toHaveBeenCalledTimes(1);
    expect(mockNostr).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(now + 31_000);
    second = service.drain(new Uint8Array(32).fill(1), identity, 'Alice');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mockBle).toHaveBeenCalledTimes(2);
    expect(mockManager.recoverPendingPaymentRequestReceiveAttempts).toHaveBeenCalledTimes(1);
  } finally {
    resumeRecovery();
    await Promise.all([first, second]);
    clock.mockRestore();
  }
});

it.each(['inband', 'nostr'])(
  'preserves sender and the winning %s transport on the canonical receive',
  async (transport) => {
    const senderPubkey = 'cd'.repeat(32);
    const finalizedResult = {
      attempt: {
        state: 'finalized',
        receiveOperationId: 'receive-a',
        senderPubkey,
        transport,
        transportMessageId: transport === 'inband' ? 'ble:payload' : 'nostr-wrap',
      },
    };
    jest
      .mocked(mockManager.paymentRequests.incoming.ingestPayload)
      .mockResolvedValue(
        finalizedResult as Awaited<
          ReturnType<Manager['paymentRequests']['incoming']['ingestPayload']>
        >
      );
    const service = nearbyPayments(mockManager);
    await service.ingest(incomingPayload(), pubkey, senderPubkey);
    await service.drain(new Uint8Array(32).fill(1), identity, 'Alice');
    expect(mockAnnotations.get('id:receive:receive-a')).toEqual({
      lock: { type: 'p2pk', direction: 'incoming' },
      ...(transport === 'inband' ? { scan: { method: 'ble' } } : {}),
      counterparty: {
        pubkey: senderPubkey,
        direction: 'sender',
        avatarUrl: 'https://profile.example/avatar.png',
      },
    });
    const journal = JSON.parse(mockStorage.get('profile-a:nearby-payment-journal')!);
    expect(journal.inbound).toEqual({});
  }
);
