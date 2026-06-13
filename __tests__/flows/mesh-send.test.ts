/**
 * Mesh send flow — startMeshSend through the standard payment-request flow.
 *
 * The solicit/plan stage runs before any machine transition; a started mesh
 * send then rides the existing creq machinery (enterAmount → mint constraint
 * from the request's `m` → navigateToPaymentRequest → confirm) with
 * ctx.meshPeerId routing the final delivery through the mesh adapter.
 */

import { describe, expect, it, vi } from 'vitest';
import { nip19 } from 'nostr-tools';
import { PaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts';

import { createTestMachine } from '../_harness';
import { MINT1 } from '../_harness/fixtures';
import type { MeshTransportAdapter } from '../../src/transport/types';

const PEER = 'deadbeefdeadbeef';
const RECEIVER_KEY = `02${'cd'.repeat(32)}`;

function buildCreq(opts: {
  lockPubkey?: string;
  mints?: string[];
  nprofile?: string;
}): string {
  return new PaymentRequest(
    opts.nprofile
      ? [{ type: PaymentRequestTransportType.NOSTR, target: opts.nprofile, tags: [['n', '17']] }]
      : [],
    'a1b2c3d4e5f60718',
    undefined,
    'sat',
    opts.mints ?? [MINT1],
    undefined,
    true,
    opts.lockPubkey ? { kind: 'P2PK', data: opts.lockPubkey, tags: [] } : undefined
  ).toEncodedRequest();
}

function adapterWith(overrides: Partial<MeshTransportAdapter>): MeshTransportAdapter {
  return {
    getPeerCapabilities: () => ({ supportsNutRequests: true, autoRedeem: true }),
    solicitPaymentRequest: async () => buildCreq({ lockPubkey: RECEIVER_KEY }),
    respondToSolicit: async () => {},
    deliverPayment: async () => {},
    sendPaymentStatus: async () => {},
    broadcastBearerToken: async () => {},
    onInbound: () => () => {},
    ...overrides,
  };
}

describe('startMeshSend', () => {
  it('locked send: solicit → enterAmount → confirm delivers with meshPeerId', async () => {
    const solicit = vi.fn(async () => buildCreq({ lockPubkey: RECEIVER_KEY }));
    const tm = createTestMachine({
      meshTransport: adapterWith({ solicitPaymentRequest: solicit }),
    });

    const start = await tm.machine.startMeshSend(PEER);
    expect(start).toEqual({ kind: 'started', mode: 'locked' });
    expect(solicit).toHaveBeenCalledWith(PEER, { senderOffline: false });
    tm.assertStep('enterAmount');
    expect(tm.machine.getContext().meshPeerId).toBe(PEER);

    await tm.machine.enterAmount(21, MINT1);
    tm.assertStep('navigateToPaymentRequest');
    const navCall = tm.handlerCalls.find((c) => c.step === 'navigateToPaymentRequest');
    expect(navCall?.data).toMatchObject({ meshPeerId: PEER, meshBearer: false });

    await tm.machine.confirmPaymentRequest();
    const call = tm.operationCalls.find((c) => c.name === 'executePaymentRequest');
    expect(call).toBeDefined();
    expect(call!.args[4]).toEqual({ meshPeerId: PEER, offline: false });
  });

  it('seeds recipientPubkey from the creq nostr transport (identity disclosure)', async () => {
    const recipientPubkey = 'ab'.repeat(32);
    const nprofile = nip19.nprofileEncode({ pubkey: recipientPubkey });
    const tm = createTestMachine({
      meshTransport: adapterWith({
        solicitPaymentRequest: async () => buildCreq({ lockPubkey: RECEIVER_KEY, nprofile }),
      }),
    });

    const start = await tm.machine.startMeshSend(PEER);
    expect(start).toEqual({ kind: 'started', mode: 'locked' });
    // The stage-2 profile resolver keys off this; the amount screen reads it
    // for the "Pay <name>" header.
    expect(tm.machine.getContext().recipientPubkey).toBe(recipientPubkey);
  });

  it('bearer send: offline option flags the request and the operation', async () => {
    const solicit = vi.fn(async () => buildCreq({}));
    const tm = createTestMachine({
      meshTransport: adapterWith({ solicitPaymentRequest: solicit }),
    });

    const start = await tm.machine.startMeshSend(PEER, { offline: true });
    expect(start).toEqual({ kind: 'started', mode: 'bearer-dm' });
    expect(solicit).toHaveBeenCalledWith(PEER, { senderOffline: true });

    await tm.machine.enterAmount(8, MINT1);
    tm.assertStep('navigateToPaymentRequest');
    const navCall = tm.handlerCalls.find((c) => c.step === 'navigateToPaymentRequest');
    expect(navCall?.data).toMatchObject({ meshBearer: true });

    await tm.machine.confirmPaymentRequest();
    const call = tm.operationCalls.find((c) => c.name === 'executePaymentRequest');
    expect(call!.args[4]).toEqual({ meshPeerId: PEER, offline: true });
  });

  it('solicit timeout aborts without touching machine state', async () => {
    const tm = createTestMachine({
      meshTransport: adapterWith({
        solicitPaymentRequest: async () => {
          throw new Error('solicit timed out');
        },
      }),
    });
    const start = await tm.machine.startMeshSend(PEER);
    expect(start).toEqual({ kind: 'abort', reason: 'solicit-timeout' });
    tm.assertStep('idle');
  });

  it('empty mint overlap aborts naming both sides', async () => {
    const tm = createTestMachine({
      meshTransport: adapterWith({
        solicitPaymentRequest: async () =>
          buildCreq({ lockPubkey: RECEIVER_KEY, mints: ['https://their.mint'] }),
      }),
    });
    const start = await tm.machine.startMeshSend(PEER);
    expect(start).toMatchObject({
      kind: 'abort',
      reason: 'no-mint-overlap',
      theirMintUrls: ['https://their.mint'],
    });
    tm.assertStep('idle');
  });

  it('vanilla peers (no beacon) return without soliciting', async () => {
    const solicit = vi.fn();
    const tm = createTestMachine({
      meshTransport: adapterWith({
        getPeerCapabilities: () => null,
        solicitPaymentRequest: solicit as never,
      }),
    });
    expect(await tm.machine.startMeshSend(PEER)).toEqual({ kind: 'vanilla' });
    expect(solicit).not.toHaveBeenCalled();
  });

  it('throws when no mesh adapter is configured', async () => {
    const tm = createTestMachine();
    await expect(tm.machine.startMeshSend(PEER)).rejects.toThrow(
      'Mesh transport adapter is not configured'
    );
  });
});
