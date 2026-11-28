/** @jest-environment node */
import type { Plugin } from '@cashu/coco-core/plugin';
import { createPaymentRequestNostrTransportPlugin } from '@/shared/lib/cashu/paymentRequestNostrTransport';

// Audit D16: where the NUT-18 receive transport reads the viewer's gift wraps
// from when nobody injects a source. It must be the payment inbox, which
// ignores the tier switches in Settings → Network, and never the social data
// layer, which those switches can leave with no relay tier (or not built).

type PluginContext = Parameters<NonNullable<Plugin['onInit']>>[0];
type Handler = Parameters<
  PluginContext['services']['paymentRequestReceiveService']['registerTransportHandler']
>[0];

const mockGetDmEnvelopes = jest.fn(async (_request: unknown) => ({
  match: (ok: (value: { envelopes: never[] }) => unknown) => ok({ envelopes: [] }),
}));
const mockSubscribeDmEnvelopes = jest.fn((_request: unknown, _onEnvelope: unknown) => jest.fn());
const mockBuildSocialLayer = jest.fn(() => null);

jest.mock('@/shared/lib/nostr/giftWrapCache', () => ({
  giftWrapCache: { unwrap: jest.fn(), cache: { hydrate: async () => undefined } },
}));
jest.mock('@/shared/lib/nostr/paymentInbox', () => ({
  getPaymentInbox: () => ({
    getDmEnvelopes: mockGetDmEnvelopes,
    subscribeDmEnvelopes: mockSubscribeDmEnvelopes,
  }),
}));
// Every tier switched off: the social layer does not exist.
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => mockBuildSocialLayer(),
}));

async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

it('polls and listens on the payment inbox, with the social data layer unavailable', async () => {
  let dispose: unknown;
  try {
    let handler: Handler | undefined;
    const plugin = createPaymentRequestNostrTransportPlugin({
      getSignerKey: () => new Uint8Array(32).fill(1),
      appState: {
        currentState: 'active',
        addEventListener: () => ({ remove: () => undefined }),
      },
    });
    const context = {
      services: {
        paymentRequestReceiveService: {
          ingestPayload: jest.fn(),
          recoverPendingAttempts: jest.fn(async () => undefined),
          registerTransportHandler: (value: Handler) => {
            handler = value;
            return jest.fn();
          },
        },
      },
    };
    dispose = await plugin.onInit?.(context as never);
    const operation = { id: 'request' };
    await handler?.activate?.(operation as never);
    await settle();

    expect(mockBuildSocialLayer).not.toHaveBeenCalled();
    expect(mockGetDmEnvelopes).toHaveBeenCalledTimes(1);
    expect(mockSubscribeDmEnvelopes).toHaveBeenCalledTimes(1);
    // The live listener's first attach is unbounded; resuming after a dropped
    // socket is the relay connection's job.
    expect(mockSubscribeDmEnvelopes.mock.calls[0]![0]).toEqual({
      viewerPubkey: expect.any(String),
    });
  } finally {
    // Stops the 15 s poll timer.
    if (typeof dispose === 'function') dispose();
  }
});
