/** @jest-environment node */
import type { Plugin } from '@cashu/coco-core/plugin';
import { createPaymentRequestNostrTransportPlugin } from '@/shared/lib/cashu/paymentRequestNostrTransport';
type PluginContext = Parameters<NonNullable<Plugin['onInit']>>[0];
type ReceiveService = PluginContext['services']['paymentRequestReceiveService'];

let mockLive:
  ((event: { id: string; kind: number; pubkey: string; content: string }) => void) | undefined;
const mockIngest = jest.fn();
const mockUnwrap = jest.fn();
jest.mock('@/shared/lib/nostr/giftWrapCache', () => ({
  giftWrapCache: {
    unwrap: (...args: unknown[]) => mockUnwrap(...args),
    cache: { hydrate: async () => undefined },
  },
}));

const envelope = { id: 'a'.repeat(64), kind: 1059, pubkey: 'b'.repeat(64), content: 'wrapped' };
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
it('retries a failed or concurrent claim but stops after a durable terminal result', async () => {
  jest.useFakeTimers();
  mockUnwrap.mockReturnValue({
    content: '{"id":"r","mint":"https://mint.example","proofs":[]}',
    senderPubkey: 'c'.repeat(64),
  });
  mockIngest
    .mockRejectedValueOnce(new Error('Operation in progress'))
    .mockResolvedValue({ attempt: { state: 'finalized' } });
  let handler: Parameters<ReceiveService['registerTransportHandler']>[0] | undefined;
  const layer = {
    getDmEnvelopes: async () => ({
      match: (ok: (value: { envelopes: never[] }) => unknown) => ok({ envelopes: [] }),
    }),
    subscribeDmEnvelopes: (_input: unknown, callback: typeof mockLive) => {
      mockLive = callback;
      return jest.fn();
    },
  };
  const plugin = createPaymentRequestNostrTransportPlugin({
    getSignerKey: () => new Uint8Array(32).fill(1),
    loadDataLayer: async () => layer as never,
  });
  const context = {
    services: {
      paymentRequestReceiveService: {
        ingestPayload: mockIngest,
        recoverPendingAttempts: jest.fn(async () => undefined),
        registerTransportHandler: (value: typeof handler) => {
          handler = value;
          return jest.fn();
        },
      },
    },
  };
  const dispose = await plugin.onInit?.(context as never);
  try {
    const operation = { id: 'request' };
    await handler?.activate?.(operation as never);
    await settle();
    expect(mockLive).toBeDefined();
    mockLive?.(envelope);
    await settle();
    mockLive?.(envelope);
    await settle();
    mockLive?.(envelope);
    await settle();
    expect(mockIngest).toHaveBeenCalledTimes(2);
    expect(mockIngest.mock.calls[1][0]).toContain('"unit":"sat"');
  } finally {
    if (typeof dispose === 'function') await dispose();
    jest.useRealTimers();
  }
});
