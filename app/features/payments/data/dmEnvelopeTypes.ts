/**
 * @fileoverview Wire shapes for the NIP-17 DM envelope transport.
 *
 * Leaf module so the facade adapter and the client can share these without
 * importing each other (the adapter is what the client calls).
 */

/** One encrypted gift wrap as it arrives from Nagg / the relay facade. */
export interface DmEnvelope {
  id: string;
  pubkey: string;
  kind: number;
  createdAt: string | number | Date;
  content: string;
  tags: string[][];
  sig?: string;
}

/** One arrival-ordered page of wraps. Paging is length-based: callers
 *  re-derive their `until` cursor from envelope `createdAt`. */
export interface DmEnvelopePage {
  envelopes: DmEnvelope[];
  hasNextPage: boolean;
}

/** Which NIP a decrypted DM arrived over. NIP-04 is legacy read-only;
 *  everything the app sends is NIP-17. */
export type DmProtocol = 'nip04' | 'nip17';
