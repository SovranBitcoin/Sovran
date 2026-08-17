import { describe, expect, it } from 'bun:test';

import { PaymentRequest, PaymentRequestTransportType, getEncodedToken } from '@cashu/cashu-ts';
import * as nip19 from 'nostr-tools/nip19';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { unwrapEvent } from 'nostr-tools/nip17';

import {
  buildPaymentRequestPayload,
  decodeNostrPaymentRequest,
  deliverPaymentRequestPayload,
} from './payment-request-payer';

const RECEIVER_SK = generateSecretKey();
const RECEIVER_PK = getPublicKey(RECEIVER_SK);
const RELAYS = ['wss://relay-a.example', 'wss://relay-b.example'];
const MINT = 'https://mint.example';

function encodeRequest(options: {
  id?: string;
  target?: string;
  transportType?: PaymentRequestTransportType;
  mints?: string[];
  unit?: string;
}): string {
  const target = options.target ?? nip19.nprofileEncode({ pubkey: RECEIVER_PK, relays: RELAYS });
  const transport = [
    {
      type: options.transportType ?? PaymentRequestTransportType.NOSTR,
      target,
      tags: [['n', '17']] as string[][],
    },
  ];
  return new PaymentRequest(
    transport,
    options.id,
    undefined,
    options.unit,
    options.mints
  ).toEncodedRequest();
}

function encodeToken(amounts: number[]): string {
  return getEncodedToken({
    mint: MINT,
    unit: 'sat',
    // cashu-ts's Token type wants Amount objects, but plain numeric NUT-00
    // proofs are exactly what cocod emits and what the encoder accepts.
    proofs: amounts.map((amount, index) => ({
      amount,
      id: '009a1f293253e41e',
      secret: `${index}`.padStart(2, '0') + 's'.repeat(30),
      C: '02' + 'a'.repeat(64),
    })) as never,
  });
}

describe('decodeNostrPaymentRequest', () => {
  it('extracts the request id, receiver pubkey, and relays from the nprofile transport', () => {
    const decoded = decodeNostrPaymentRequest(
      encodeRequest({ id: 'req-1', mints: [MINT], unit: 'sat' })
    );
    expect(decoded.requestId).toBe('req-1');
    expect(decoded.receiverPubkey).toBe(RECEIVER_PK);
    expect(decoded.relays).toEqual(RELAYS);
    expect(decoded.mints).toEqual([MINT]);
    expect(decoded.unit).toBe('sat');
  });

  it('rejects a value that is not an encoded payment request', () => {
    expect(() => decodeNostrPaymentRequest('lnbc1notacreq')).toThrow('NUT-18');
  });

  it('rejects a request without an id — the receiver could never match a claim', () => {
    expect(() => decodeNostrPaymentRequest(encodeRequest({}))).toThrow('no id');
  });

  it('rejects a request whose transport target is not an nprofile', () => {
    const npub = nip19.npubEncode(RECEIVER_PK);
    expect(() => decodeNostrPaymentRequest(encodeRequest({ id: 'req-1', target: npub }))).toThrow(
      'not an nprofile'
    );
  });

  it('rejects a request whose nprofile names no relays', () => {
    const target = nip19.nprofileEncode({ pubkey: RECEIVER_PK, relays: [] });
    expect(() => decodeNostrPaymentRequest(encodeRequest({ id: 'req-1', target }))).toThrow(
      'no relays'
    );
  });
});

describe('buildPaymentRequestPayload', () => {
  it('builds plain-number NUT-18 payload JSON that passes the receiver gate', () => {
    const json = buildPaymentRequestPayload({
      requestId: 'req-1',
      token: encodeToken([16, 8, 1]),
      mintUrl: MINT,
      unit: 'sat',
      amount: 25,
      memo: '[E2E] payment request',
    });
    expect(json.startsWith('{')).toBe(true);
    expect(json).toContain('"proofs"');
    expect(json).toContain('"mint"');
    const payload = JSON.parse(json) as {
      id: string;
      unit: string;
      mint: string;
      memo: string;
      proofs: { amount: unknown; id: string; secret: string; C: string }[];
    };
    expect(payload.id).toBe('req-1');
    expect(payload.unit).toBe('sat');
    expect(payload.mint).toBe(MINT);
    expect(payload.memo).toBe('[E2E] payment request');
    expect(payload.proofs.map((proof) => proof.amount)).toEqual([16, 8, 1]);
  });

  it('rejects a token from a different mint', () => {
    expect(() =>
      buildPaymentRequestPayload({
        requestId: 'req-1',
        token: encodeToken([25]),
        mintUrl: 'https://other.example',
        unit: 'sat',
        amount: 25,
      })
    ).toThrow('not from the declared mint');
  });

  it('rejects a token whose proofs do not sum to the declared amount', () => {
    expect(() =>
      buildPaymentRequestPayload({
        requestId: 'req-1',
        token: encodeToken([16, 8]),
        mintUrl: MINT,
        unit: 'sat',
        amount: 25,
      })
    ).toThrow('do not sum');
  });
});

describe('deliverPaymentRequestPayload', () => {
  it('produces a kind-1059 wrap the receiver can unwrap back to the payload', async () => {
    // Drive the real wrap path through a loopback relay: accept the EVENT
    // frame, ack OK, and prove the receiver-side unwrap recovers the payload.
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        return srv.upgrade(req) ? undefined : new Response('no', { status: 400 });
      },
      websocket: {
        message(ws, raw) {
          const frame = JSON.parse(String(raw)) as [string, { id: string; kind: number }];
          if (frame[0] !== 'EVENT') return;
          capturedWrap = frame[1];
          ws.send(JSON.stringify(['OK', frame[1].id, true, '']));
        },
      },
    });
    let capturedWrap: { id: string; kind: number } | undefined;
    try {
      const payloadJson = JSON.stringify({ id: 'req-1', mint: MINT, proofs: [] });
      const delivered = await deliverPaymentRequestPayload({
        payloadJson,
        receiverPubkey: RECEIVER_PK,
        relays: [`ws://localhost:${server.port}`],
        timeoutMs: 5_000,
      });
      expect(delivered.acceptedBy).toBe(`ws://localhost:${server.port}`);
      expect(capturedWrap).toBeDefined();
      expect(capturedWrap!.kind).toBe(1059);
      expect(capturedWrap!.id).toBe(delivered.wrapEventId);
      const rumor = unwrapEvent(capturedWrap as never, RECEIVER_SK);
      expect(rumor.kind).toBe(14);
      expect(rumor.content).toBe(payloadJson);
    } finally {
      await server.stop(true);
    }
  });

  it('fails with every relay reason when no relay accepts', async () => {
    await expect(
      deliverPaymentRequestPayload({
        payloadJson: '{}',
        receiverPubkey: RECEIVER_PK,
        relays: ['ws://localhost:1'],
        timeoutMs: 1_500,
      })
    ).rejects.toThrow('failed on every relay');
  });
});
