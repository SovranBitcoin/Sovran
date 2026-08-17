/** Payer side of a NUT-18 payment request over its Nostr transport.
 *
 * The app's standing payment requests advertise exactly one transport: a
 * NIP-17 gift-wrap inbox addressed by an nprofile (receiver pubkey + relays).
 * cocod cannot speak Nostr, so the harness itself is the deliverer: it wraps
 * the NUT-18 `PaymentRequestPayload` JSON as a kind-14 rumor inside a
 * kind-1059 gift wrap from a throwaway sender key and publishes it to the
 * nprofile's relays. The receiving app unwraps and auto-redeems (live
 * subscription plus a 15s poll backstop).
 *
 * Privacy/safety: the payload embeds bearer proofs, but the gift wrap
 * encrypts it to the receiver's pubkey before anything crosses the network,
 * and nothing here logs payload, proofs, or keys — callers only see relay
 * hosts and event ids. The throwaway sender key never leaves this module.
 */

import { decodePaymentRequest, getDecodedToken } from '@cashu/cashu-ts';
import { wrapEvent } from 'nostr-tools/nip17';
import * as nip19 from 'nostr-tools/nip19';
import { generateSecretKey } from 'nostr-tools/pure';

interface NostrPaymentRequestTarget {
  requestId: string;
  receiverPubkey: string;
  relays: string[];
  /** Mints the request advertises; empty means the request did not restrict. */
  mints: string[];
  unit?: string;
}

/** Decode an encoded creq and extract the Nostr delivery target. Throws on
 * anything other than a well-formed request with a usable nostr transport. */
export function decodeNostrPaymentRequest(encoded: string): NostrPaymentRequestTarget {
  if (encoded !== encoded.trim() || !/^creq[ab]/i.test(encoded)) {
    throw new Error('paymentRequest.pay requires an encoded NUT-18 payment request');
  }
  const request = decodePaymentRequest(encoded);
  if (!request.id) {
    throw new Error('payment request has no id — the receiver cannot match a claim');
  }
  const transport = (request.transport ?? []).find((t) => t.type === 'nostr');
  if (!transport) {
    throw new Error('payment request advertises no nostr transport');
  }
  const decoded = nip19.decode(transport.target);
  if (decoded.type !== 'nprofile') {
    throw new Error('nostr transport target is not an nprofile');
  }
  const relays = decoded.data.relays ?? [];
  if (relays.length === 0) {
    throw new Error('nostr transport nprofile names no relays');
  }
  return {
    requestId: request.id,
    receiverPubkey: decoded.data.pubkey,
    relays,
    mints: request.mints ?? [],
    ...(request.unit ? { unit: request.unit } : {}),
  };
}

/** cashu-ts 4.x decodes proof amounts as Amount objects (which JSON-serialize
 * to strings); the receiver's NUT-00 schema needs plain numbers. */
function amountToNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('token proof has a non-integer amount');
  }
  return parsed;
}

/** Build the NUT-18 PaymentRequestPayload JSON from a cocod-minted token.
 * The receiver gate requires the literal substrings "proofs" and "mint" and a
 * leading "{" — plain JSON.stringify of this shape satisfies all three. */
export function buildPaymentRequestPayload(params: {
  requestId: string;
  token: string;
  mintUrl: string;
  unit: string;
  amount: number;
  memo?: string;
}): string {
  const decoded = getDecodedToken(params.token, []);
  if (decoded.mint !== params.mintUrl) {
    throw new Error('minted token is not from the declared mint');
  }
  const proofs = decoded.proofs.map((proof) => ({
    amount: amountToNumber(proof.amount),
    id: proof.id,
    secret: proof.secret,
    C: proof.C,
    ...(proof.dleq ? { dleq: proof.dleq } : {}),
  }));
  const total = proofs.reduce((sum, proof) => sum + proof.amount, 0);
  if (total !== params.amount) {
    throw new Error('minted token proofs do not sum to the declared amount');
  }
  return JSON.stringify({
    id: params.requestId,
    unit: params.unit,
    mint: params.mintUrl,
    proofs,
    ...(params.memo ? { memo: params.memo } : {}),
  });
}

function publishToRelay(
  relayUrl: string,
  frame: string,
  eventId: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(relayUrl);
    } catch (error) {
      reject(new Error(`relay ${relayUrl}: ${error instanceof Error ? error.message : error}`));
      return;
    }
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`relay ${relayUrl}: timed out awaiting OK`));
    }, timeoutMs);
    const fail = (message: string) => {
      clearTimeout(timer);
      socket.close();
      reject(new Error(`relay ${relayUrl}: ${message}`));
    };
    socket.onopen = () => socket.send(frame);
    socket.onerror = () => fail('websocket error');
    socket.onclose = () => fail('closed before OK');
    socket.onmessage = (message) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (!Array.isArray(parsed) || parsed[0] !== 'OK' || parsed[1] !== eventId) return;
      if (parsed[2] === true) {
        clearTimeout(timer);
        // Detach the close handler before closing: a post-OK close is success.
        socket.onclose = null;
        socket.close();
        resolve(relayUrl);
      } else {
        fail(`rejected event: ${String(parsed[3] ?? 'no reason')}`);
      }
    };
  });
}

/** Gift-wrap the payload to the receiver and publish to the target relays.
 * Resolves once ANY relay acknowledges the wrap (the app subscribes to all of
 * them); rejects only if every relay fails. Returns delivery evidence that is
 * safe to log — no payload, proofs, or key material. */
export async function deliverPaymentRequestPayload(params: {
  payloadJson: string;
  receiverPubkey: string;
  relays: string[];
  timeoutMs: number;
}): Promise<{ wrapEventId: string; acceptedBy: string }> {
  const senderPrivateKey = generateSecretKey();
  const wrap = wrapEvent(
    senderPrivateKey,
    { publicKey: params.receiverPubkey },
    params.payloadJson
  );
  const frame = JSON.stringify(['EVENT', wrap]);
  // Re-publishing the same wrap event id is idempotent, and the token is
  // durably recorded as prepared before delivery — so a short retry rides out
  // transient all-relay publish failures without weakening the liability
  // contract (one such failure quarantined a whole funded chunk).
  const maxAttempts = 3;
  let lastReasons: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attempts = params.relays.map((relay) =>
      publishToRelay(relay, frame, wrap.id, params.timeoutMs)
    );
    try {
      const acceptedBy = await Promise.any(attempts);
      return { wrapEventId: wrap.id, acceptedBy };
    } catch (error) {
      lastReasons =
        error instanceof AggregateError
          ? error.errors.map((entry) => (entry instanceof Error ? entry.message : String(entry)))
          : [error instanceof Error ? error.message : String(error)];
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  throw new Error(
    `payment request delivery failed on every relay (${maxAttempts} rounds): ${lastReasons.join('; ')}`
  );
}
