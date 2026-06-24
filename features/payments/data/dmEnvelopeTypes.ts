/**
 * Shared DM envelope shapes. Kept in their own module so the envelope client
 * (`dmEnvelopeClient`) and the facade adapter (`facadeDmAdapter`) can both
 * depend on them without importing each other — the adapter maps into these
 * types, the client returns them.
 *
 * An envelope is a raw, still-encrypted event as returned by nagg (NIP-17 gift
 * wrap kind 1059, or legacy NIP-04 kind 4); decryption happens client-side in
 * `dmDecryptPipeline`.
 */

/** Raw DM envelope event as returned by nagg (still encrypted). */
export interface DmEnvelope {
  id: string;
  pubkey: string;
  kind: number;
  createdAt: string | number | Date;
  content: string;
  tags: string[][];
  sig?: string;
}

export interface DmEnvelopePage {
  envelopes: DmEnvelope[];
  endCursor?: string;
  hasNextPage: boolean;
}
