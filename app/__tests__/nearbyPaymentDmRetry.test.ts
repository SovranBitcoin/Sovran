/** @jest-environment node */
/**
 * The retry path for a nearby payment's NUT-18 DM that was prepared but not
 * delivered (`nearbyPayments(...).drain`), run with the real direct-message
 * sender: a real NIP-17 gift wrap is built once, persisted in the delivery
 * journal, and handed to a fake relay pool on every attempt.
 *
 * Pinned: what each drain re-sends over Nostr and Bluetooth, how often, and
 * what is never re-sent or rebuilt (the signed wrap and the payload bytes). Existing `nearbyPayments.test.ts` mocks the sender and
 * covers intent recovery and the inbound side.
 */
import { Amount, PaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts';
import type { Manager } from '@cashu/coco-core';
import { nprofileEncode } from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';
import { captureNearbyDelivery, nearbyPayments } from '@/features/nearPay/lib/nearbyPayments';
import { unwrapGiftWrap } from '@/shared/lib/nostr/nip17';

type SignedEvent = { id: string; sig: string; content: string; pubkey: string; kind: number };

const mockStorage = new Map<string, string>();
let mockManager: Manager;
let mockPeer: Record<string, unknown>;
let mockActive: Record<string, unknown> | null;
const mockComplete = jest.fn();
const mockBle = jest.fn();
let mockBleListener: ((event: { messageID: string; status: string }) => void) | undefined;
const mockRelayPublish = jest.fn<Promise<string>[], [string[], SignedEvent]>();
const mockRelayClose = jest.fn();

jest.mock('nostr-tools/pool', () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    publish: (relays: string[], event: SignedEvent) => mockRelayPublish(relays, event),
    close: (relays: string[]) => mockRelayClose(relays),
  })),
}));
jest.mock('@/shared/lib/persist/secureVault', () => ({
  createSecureVault: (owner: string, name: string) => ({
    read: async () => mockStorage.get(`${owner}:${name}`) ?? null,
    write: async (value: string) => void mockStorage.set(`${owner}:${name}`, value),
  }),
}));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { isInitialized: () => true, getInstance: () => mockManager },
}));
jest.mock('@/features/bitchat/lib/profileScope', () => ({
  getBitchatProfileScope: () => 'profile-a',
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
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: jest.fn(),
}));
jest.mock('@/shared/lib/nostr/useEntityCache', () => ({ readProfileRecord: () => undefined }));
jest.mock('@/shared/lib/cashu/offlineReceiveDleq', () => ({ requireOfflineTokenDleq: jest.fn() }));
jest.mock('bitchat-module', () => ({
  addBLEDeliveryStatusListener: (listener: typeof mockBleListener) => {
    mockBleListener = listener;
    return {
      remove: () => {
        mockBleListener = undefined;
      },
    };
  },
  sendBLEPrivateMessage: (...args: unknown[]) => mockBle(...args),
}));

const RECIPIENT_SECRET = new Uint8Array(32).fill(3);
const RECIPIENT = getPublicKey(RECIPIENT_SECRET);
const SENDER_SECRET = new Uint8Array(32).fill(1);
const RELAYS = ['wss://inbox-a.example', 'wss://inbox-b.example'];
const MINT = 'https://mint.example';
const IDENTITY = {
  version: 'sovran-bitchat-ble-v1' as const,
  nostrPubkey: 'ef'.repeat(32),
  noisePrivateKeyHex: '01'.repeat(32),
  signingPrivateKeyHex: '02'.repeat(32),
};
const CREQ = new PaymentRequest(
  [
    {
      type: PaymentRequestTransportType.NOSTR,
      target: nprofileEncode({ pubkey: RECIPIENT, relays: RELAYS }),
    },
  ],
  'request-a',
  undefined,
  'sat',
  [MINT],
  undefined,
  false,
  { kind: 'P2PK', data: `02${RECIPIENT}`, tags: [] }
).toEncodedRequest();
const TOKEN = {
  mint: MINT,
  unit: 'sat',
  proofs: [
    { id: '00'.repeat(8), amount: Amount.from(2), secret: 's-1', C: '02' + 'cd'.repeat(32) },
  ],
};

let sendState = 'pending';
const sendGet = jest.fn(async () => ({ id: 'send-a', state: sendState, token: TOKEN }));
function freshManager() {
  return {
    mint: { isTrustedMint: jest.fn(async () => true) },
    recoverPendingPaymentRequestReceiveAttempts: jest.fn(async () => undefined),
    paymentRequests: { incoming: { list: jest.fn(async () => []), ingestPayload: jest.fn() } },
    ops: { send: { get: sendGet } },
  } as unknown as Manager;
}

let relaysAccept = false;
let bleAcks = false;
let clock = 1_794_000_000_000;

beforeEach(() => {
  mockStorage.clear();
  mockComplete.mockReset();
  mockRelayPublish.mockReset();
  mockRelayClose.mockReset();
  mockBle.mockReset();
  sendGet.mockClear();
  sendState = 'pending';
  relaysAccept = false;
  bleAcks = false;
  clock = 1_794_000_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  mockRelayPublish.mockImplementation((relays) =>
    relays.map(() => (relaysAccept ? Promise.resolve('ok') : Promise.reject(new Error('blocked'))))
  );
  mockBle.mockImplementation(async ({ messageID }: { messageID: string }) => {
    mockBleListener?.({ messageID, status: bleAcks ? 'delivered' : 'failed' });
  });
  mockManager = freshManager();
  mockPeer = {
    peerID: 'peer-a',
    nostrPubkeyHex: RECIPIENT,
    creq: CREQ,
    walletCapabilityExpiresAt: clock + 120_000,
  };
  mockActive = { id: 'session-a', recipient: mockPeer };
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function bindSend() {
  const bind = captureNearbyDelivery({
    manager: mockManager,
    mintUrl: MINT,
    lockPubkey: `02${RECIPIENT}`,
  });
  await bind!('send-a');
}

const drain = () => nearbyPayments(mockManager).drain(SENDER_SECRET, IDENTITY, 'Alice');

function journal() {
  return JSON.parse(mockStorage.get('profile-a:nearby-payment-journal')!) as {
    outbound: Record<string, Record<string, unknown>>;
  };
}

const published = () => mockRelayPublish.mock.calls.map(([relays, event]) => ({ relays, event }));

describe('re-sending a prepared payment-request DM', () => {
  it('replays the one signed wrap, byte for byte, until a relay accepts', async () => {
    await bindSend();

    await drain();
    clock += 31_000;
    relaysAccept = true;
    await drain();

    const [first, second] = published();
    expect(published()).toHaveLength(2);
    expect(second).toEqual(first);
    expect(first!.relays).toEqual(RELAYS);
    expect(first!.event.kind).toBe(1059);
    // The recipient opens the same NUT-18 payload from either attempt.
    const opened = unwrapGiftWrap(second!.event, RECIPIENT_SECRET);
    expect(JSON.parse(opened!.content)).toMatchObject({
      id: 'request-a',
      mint: MINT,
      unit: 'sat',
      proofs: [{ amount: 2, secret: 's-1' }],
    });
    expect(mockRelayClose).toHaveBeenCalledTimes(2);
    expect(mockRelayClose).toHaveBeenLastCalledWith(RELAYS);
    // Relay acceptance completes the nearby session; it is not settlement.
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(journal().outbound['send-a']).toMatchObject({
      nostrAccepted: true,
      bleAccepted: false,
      nostrEnvelope: { event: first!.event, relays: RELAYS },
    });
  });

  it('replays the persisted wrap after a restart instead of building a new one', async () => {
    await bindSend();
    await drain();
    const before = published()[0]!.event;

    mockManager = freshManager();
    clock += 31_000;
    await drain();

    expect(published()).toHaveLength(2);
    expect(published()[1]!.event).toEqual(before);
  });

  it('sends nothing again within 30 seconds of the last attempt', async () => {
    await bindSend();
    await drain();
    clock += 29_000;
    await drain();

    expect(published()).toHaveLength(1);
    expect(mockBle).toHaveBeenCalledTimes(1);
  });

  it('stops publishing over Nostr once a relay accepted, but keeps re-sending over Bluetooth', async () => {
    relaysAccept = true;
    await bindSend();
    await drain();
    clock += 31_000;
    await drain();
    clock += 31_000;
    await drain();

    expect(published()).toHaveLength(1);
    expect(mockBle).toHaveBeenCalledTimes(3);
  });

  it('re-sends over Bluetooth even after both transports accepted while the send stays pending', async () => {
    relaysAccept = true;
    bleAcks = true;
    await bindSend();
    await drain();
    expect(journal().outbound['send-a']).toMatchObject({ bleAccepted: true, nostrAccepted: true });
    clock += 31_000;
    await drain();

    // QUIRK: bleAccepted is recorded but never read, so a pending send's
    // payload goes out over Bluetooth again on every pass after 30 seconds.
    expect(mockBle).toHaveBeenCalledTimes(2);
    expect(published()).toHaveLength(1);
    expect(mockBle.mock.calls[1][0].content).toBe(mockBle.mock.calls[0][0].content);
  });

  it.each(['finalized', 'rolled_back'])(
    'drops the delivery and sends nothing once the send is %s',
    async (state) => {
      await bindSend();
      sendState = state;
      await drain();

      expect(published()).toHaveLength(0);
      expect(mockBle).not.toHaveBeenCalled();
      expect(journal().outbound).toEqual({});
    }
  );

  it.each(['prepared', 'executing'])(
    'keeps the delivery but sends nothing while the send is %s',
    async (state) => {
      await bindSend();
      sendState = state;
      await drain();

      expect(published()).toHaveLength(0);
      expect(mockBle).not.toHaveBeenCalled();
      expect(journal().outbound['send-a']).toBeDefined();
    }
  );

  it('runs one delivery pass at a time', async () => {
    await bindSend();
    await Promise.all([drain(), drain()]);

    expect(published()).toHaveLength(1);
    expect(mockBle).toHaveBeenCalledTimes(1);
  });
});
