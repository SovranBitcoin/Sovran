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
 * app-wide listener (shared/providers/BitchatBLEProvider.tsx) keeps those, and
 * a DM that is nothing but a token, out of the chat store. The prefixes come
 * from the real modules; only the native module and the hooks the provider
 * also mounts are stubbed.
 */

type PrivateMessage = BLEPrivateMessageEvent;

let mockListener: ((event: PrivateMessage) => void) | undefined;
jest.mock('bitchat-module', () => ({
  startBLE: jest.fn(),
  addBLEDeliveryStatusListener: jest.fn(() => ({ remove: jest.fn() })),
  addBLEPrivateMessageListener: jest.fn((listener: (event: PrivateMessage) => void) => {
    mockListener = listener;
    return { remove: jest.fn() };
  }),
  sendBLEPrivateMessage: jest.fn(),
}));
// The provider also mounts discovery and auto-redeem; each has its own tests.
jest.mock('@/features/nearPay/hooks/useNearbyDiscovery', () => ({ useNearbyDiscovery: jest.fn() }));
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
async function shownAsChat(content: string): Promise<boolean> {
  mockAppendIncoming.mockClear();
  mockListener?.(message(content));
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
    expect(mockListener).toBeDefined();
  });

  afterAll(() => renderer?.unmount());

  it('keeps a version 1 nearby payment out of the chat', async () => {
    expect(await shownAsChat(`sovran:payment:1:${PAYLOAD}`)).toBe(false);
  });

  it('keeps a version 1 nearby capability out of the chat', async () => {
    expect(await shownAsChat('sovran:nearby:1:{"kind":21118}')).toBe(false);
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

  it('shows a version 2 nearby payment as chat', async () => {
    // QUIRK: only the `:1:` prefixes are matched, so a later version's payment,
    // proofs and all, is stored and shown as a chat bubble.
    expect(await shownAsChat(`sovran:payment:2:${PAYLOAD}`)).toBe(true);
  });

  it('shows a version 2 nearby capability as chat', async () => {
    // QUIRK: as above, for the capability.
    expect(await shownAsChat('sovran:nearby:2:{"kind":21118}')).toBe(true);
  });
});
