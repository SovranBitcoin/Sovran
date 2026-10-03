import { z } from 'zod';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { decode as decodeNostr } from 'nostr-tools/nip19';
import { decodePaymentRequest } from '@cashu/cashu-ts';
import type { BLEPeer } from 'bitchat-module';
import { lockableMintsFromCreq } from '@/shared/lib/nutCreq';

export const CAPABILITY_PREFIX = 'sovran:nearby:1:';
const KIND = 21118;
const LIFETIME_SECONDS = 120;
const hexKey = z.string().regex(/^[0-9a-f]{64}$/);
const eventSchema = z.object({
  id: hexKey,
  pubkey: hexKey,
  sig: z.string().regex(/^[0-9a-f]{128}$/),
  kind: z.literal(KIND),
  created_at: z.number().int(),
  tags: z.array(z.array(z.string()).max(4)).max(4),
  content: z.string().max(12_000),
});
const capabilitySchema = z.object({
  protocol: z.literal('sovran-nearby'),
  version: z.literal(1),
  noiseKey: hexKey,
  expiresAt: z.number().int(),
  creq: z.string().max(10_000).nullable(),
});
export interface VerifiedNearbyCapability {
  fingerprint: string;
  nostrPubkeyHex: string;
  creq: string | null;
  expiresAt: number;
  issuedAt: number;
}
export function nearbyNoiseIdentity(noisePrivateKeyHex: string) {
  const publicKey = x25519.getPublicKey(hexToBytes(noisePrivateKeyHex));
  const fingerprint = bytesToHex(sha256(publicKey));
  return { noiseKey: bytesToHex(publicKey), fingerprint, peerID: fingerprint.slice(0, 16) };
}
export function createNearbyCapability(
  privateKey: Uint8Array,
  noisePrivateKeyHex: string,
  creq: string | null,
  now = Date.now()
): string {
  const created_at = Math.floor(now / 1000);
  return (
    CAPABILITY_PREFIX +
    JSON.stringify(
      finalizeEvent(
        {
          kind: KIND,
          created_at,
          tags: [],
          content: JSON.stringify({
            protocol: 'sovran-nearby',
            version: 1,
            noiseKey: nearbyNoiseIdentity(noisePrivateKeyHex).noiseKey,
            expiresAt: created_at + LIFETIME_SECONDS,
            creq,
          }),
        },
        privateKey
      )
    )
  );
}
/** Authenticate the payment key against the *session* key, never an announce. */
export function verifyNearbyCapability(
  content: string,
  authenticatedFingerprint: string | undefined,
  now = Date.now()
): VerifiedNearbyCapability | null {
  if (
    !authenticatedFingerprint ||
    !content.startsWith(CAPABILITY_PREFIX) ||
    content.length > 16_000
  )
    return null;
  try {
    const event = eventSchema.parse(JSON.parse(content.slice(CAPABILITY_PREFIX.length)));
    if (!verifyEvent(event)) return null;
    const cap = capabilitySchema.parse(JSON.parse(event.content));
    const seconds = Math.floor(now / 1000);
    if (
      event.created_at > seconds + 15 ||
      cap.expiresAt <= seconds ||
      cap.expiresAt - event.created_at > LIFETIME_SECONDS ||
      cap.expiresAt <= event.created_at
    )
      return null;
    const fingerprint = bytesToHex(sha256(hexToBytes(cap.noiseKey)));
    if (fingerprint !== authenticatedFingerprint) return null;
    if (cap.creq) {
      const request = decodePaymentRequest(cap.creq);
      const target = request.transport?.find((transport) => transport.type === 'nostr')?.target;
      if (target) {
        const decodedTarget = decodeNostr(target);
        if (decodedTarget.type !== 'nprofile' || decodedTarget.data.pubkey !== event.pubkey)
          return null;
      }
      if (
        !request.id ||
        request.unit !== 'sat' ||
        request.amount !== undefined ||
        !!request.nut10?.tags?.length ||
        request.singleUse ||
        !lockableMintsFromCreq(cap.creq, event.pubkey)?.length
      )
        return null;
    }
    return {
      fingerprint,
      nostrPubkeyHex: event.pubkey,
      creq: cap.creq,
      expiresAt: cap.expiresAt * 1000,
      issuedAt: event.created_at,
    };
  } catch {
    return null;
  }
}
export function isPayableNearbyPeer(
  peer: Pick<BLEPeer, 'walletCapabilityExpiresAt' | 'creq' | 'nostrPubkeyHex'>,
  now = Date.now()
): boolean {
  return (
    (peer.walletCapabilityExpiresAt ?? 0) > now &&
    !!lockableMintsFromCreq(peer.creq, peer.nostrPubkeyHex)?.length
  );
}
