/**
 * NIP-46 request-shape parsing — the pure pre-gate step.
 *
 * Turns a decoded `RpcRequest` into a `{ unsigned, kind, preview }` shape: it
 * validates per-method params and builds the approval preview. It is a pure
 * function of its argument — no engine state, no key access, no I/O — and makes
 * NO authorization decision (the policy gates run later in the engine pipeline).
 * Kept out of `nip46Engine` so the security-critical inbound pipeline there
 * stays a single, source-ordered read of the gates.
 */
import { err, ok, Result } from 'neverthrow';

import type { Nip46ParamsPreview } from '@/features/nostrSigner/data/nip46RequestsStore';
import { safeJsonParse } from '@/features/nostrSigner/lib/json';
import {
  UnsignedEventSchema,
  type RpcRequest,
  type UnsignedEvent,
} from '@/features/nostrSigner/lib/nip46Types';
import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';

interface ParsedSignParams {
  unsigned: UnsignedEvent | null;
  kind: number | undefined;
  preview: Nip46ParamsPreview;
}

export function parseMethodParams(request: RpcRequest): Result<ParsedSignParams, 'malformed'> {
  if (request.method === 'sign_event') {
    const raw = request.params[0];
    if (raw === undefined) return err('malformed');
    const json = safeJsonParse(raw);
    if (json.isErr()) return err('malformed');
    const unsigned = UnsignedEventSchema.safeParse(json.value);
    if (!unsigned.success) return err('malformed');
    return ok({
      unsigned: unsigned.data,
      kind: unsigned.data.kind,
      preview: { type: 'sign_event', event: unsigned.data },
    });
  }
  if (request.method === 'nip04_encrypt' || request.method === 'nip44_encrypt') {
    const [peer, plaintext] = request.params;
    if (peer === undefined || plaintext === undefined || !isNostrPubkeyHex(peer)) {
      return err('malformed');
    }
    return ok({
      unsigned: null,
      kind: undefined,
      preview: { type: 'encrypt', peerPubkey: peer.toLowerCase(), plaintext },
    });
  }
  if (request.method === 'nip04_decrypt' || request.method === 'nip44_decrypt') {
    const [peer, ciphertext] = request.params;
    if (peer === undefined || ciphertext === undefined || !isNostrPubkeyHex(peer)) {
      return err('malformed');
    }
    return ok({
      unsigned: null,
      kind: undefined,
      preview: {
        type: 'decrypt',
        peerPubkey: peer.toLowerCase(),
        ciphertextLength: ciphertext.length,
      },
    });
  }
  return ok({ unsigned: null, kind: undefined, preview: { type: 'none' } });
}
