import TestRenderer, { act } from 'react-test-renderer';
import { Amount, getEncodedToken } from '@cashu/cashu-ts';
import type { BLEPrivateMessageEvent } from 'bitchat-module';

import { BitchatBLEProvider } from '@/shared/providers/BitchatBLEProvider';

/**
 * Which private BitChat messages the provider puts in the chat thread.
 *
 * Sovran's own nearby formats travel as BitChat private messages with a
 * versioned prefix (features/nearPay/lib/nearbyCapability.ts `CAPABILITY_PREFIX`,
 * features/nearPay/lib/nearbyPayments.ts `NEARBY_PAYMENT_PREFIX`). The provider's
 * app-wide listener (shared/providers/BitchatBLEProvider.tsx) keeps the whole
 * `sovran:` namespace, whatever its kind or version, and a DM that is nothing
 * but a token, out of the chat store. The prefixes come from the real modules;
 * only the native module and the hooks the provider also mounts are stubbed.
 * The native module hands every message to every listener, so the stand-in
 * for discovery's listener shows what the payment and capability handlers get.
 */

type PrivateMessage = BLEPrivateMessageEvent;

const mockListeners = new Set<(event: PrivateMessage) => void>();
jest.mock('bitchat-module', () => ({
  startBLE: jest.fn(),
  addBLEDeliveryStatusListener: jest.fn(() => ({ remove: jest.fn() })),
  addBLEPrivateMessageListener: jest.fn((listener: (event: PrivateMessage) => void) => {
    mockListeners.add(listener);
    return { remove: () => mockListeners.delete(listener) };
  }),
  sendBLEPrivateMessage: jest.fn(),
}));
// The provider also mounts discovery and auto-redeem; each has its own tests.
// Discovery's stand-in listens as the real hook does and records every message.
const mockProtocolReceived: string[] = [];
jest.mock('@/features/nearPay/hooks/useNearbyDiscovery', () => ({
  useNearbyDiscovery: () => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    const native = jest.requireMock<typeof import('bitchat-module')>('bitchat-module');
    useEffect(() => {
      const subscription = native.addBLEPrivateMessageListener((event) => {
        mockProtocolReceived.push(event.content);
      });
      return () => subscription.remove();
    }, [native]);
  },
}));
jest.mock('@/features/nearPay/hooks/useNutDropAutoRedeem', () => ({
  useNutDropAutoRedeem: jest.fn(),
}));
// The mount and unmount timing lines would print after the last test.
jest.mock('@/shared/lib/logger', () => ({
  ...jest.requireActual<object>('@/shared/lib/logger'),
  initLog: jest.fn(),
  useInitMount: jest.fn(),
}));

const mockAppendIncoming = jest.fn();
jest.mock('@/features/bitchat/stores/bitchatDmMessages', () => ({
  useBitchatDmMessagesStore: {
    getState: () => ({ appendIncoming: mockAppendIncoming, applyDeliveryStatus: jest.fn() }),
  },
}));

/** A NUT-18 payload as the nearby payment carries it. */
const PAYLOAD = JSON.stringify({
  id: 'request',
  mint: 'https://mint.example',
  unit: 'sat',
  proofs: [{ id: '00ad268c4d1f5826', amount: 8, secret: 's', C: '02'.padEnd(66, 'a') }],
});

function message(content: string): PrivateMessage {
  return {
    id: `m-${content.length}`,
    peerID: '0123456789abcdef',
    sender: 'anon1234',
    content,
    timestamp: 1_789_000_000_000,
    isOwn: false,
  };
}

/** Whether the provider put this message in the chat store. */
async function shownAsChat(content: string, isOwn = false): Promise<boolean> {
  mockAppendIncoming.mockClear();
  mockProtocolReceived.length = 0;
  for (const listener of [...mockListeners]) listener({ ...message(content), isOwn });
  return mockAppendIncoming.mock.calls.length > 0;
}

describe('a private BitChat message with a sovran: prefix', () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;

  beforeAll(async () => {
    // The logger prints every entry; this file's console is its own.
    for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
      jest.spyOn(console, method).mockImplementation(() => {});
    }
    await act(async () => {
      renderer = TestRenderer.create(
        <BitchatBLEProvider>
          <></>
        </BitchatBLEProvider>
      );
    });
    // The provider's chat listener and discovery's.
    expect(mockListeners.size).toBe(2);
  });

  afterAll(() => renderer?.unmount());

  it('keeps a version 1 nearby payment out of the chat and still hands it to the handlers', async () => {
    const content = `sovran:payment:1:${PAYLOAD}`;
    expect(await shownAsChat(content)).toBe(false);
    expect(mockProtocolReceived).toEqual([content]);
  });

  it('keeps a version 1 nearby capability out of the chat and still hands it to the handlers', async () => {
    const content = 'sovran:nearby:1:{"kind":21118}';
    expect(await shownAsChat(content)).toBe(false);
    expect(mockProtocolReceived).toEqual([content]);
  });

  it('keeps a DM that is nothing but a token out of the chat, and shows ordinary chat', async () => {
    const token = getEncodedToken({
      mint: 'https://mint.example',
      unit: 'sat',
      proofs: [
        { id: '00ad268c4d1f5826', amount: Amount.from(8), secret: 's', C: '02'.padEnd(66, 'a') },
      ],
    });
    expect(await shownAsChat(token)).toBe(false);
    expect(await shownAsChat('see you at the meetup')).toBe(true);
  });

  it('keeps a version 2 nearby payment out of the chat', async () => {
    expect(await shownAsChat(`sovran:payment:2:${PAYLOAD}`)).toBe(false);
  });

  it('keeps a version 2 nearby capability out of the chat', async () => {
    expect(await shownAsChat('sovran:nearby:2:{"kind":21118}')).toBe(false);
  });

  it('keeps a sovran: message of a kind this build does not know out of the chat', async () => {
    expect(await shownAsChat('sovran:receipt:1:{}')).toBe(false);
    expect(await shownAsChat('sovran:')).toBe(false);
  });

  it('keeps an echo of this phone’s own sovran: message out of the chat', async () => {
    expect(await shownAsChat(`sovran:payment:2:${PAYLOAD}`, true)).toBe(false);
  });

  it('shows ordinary chat that only mentions sovran', async () => {
    expect(await shownAsChat('try sovran: it is a wallet')).toBe(true);
    expect(await shownAsChat('Sovran:payment is cool')).toBe(true);
  });
});
