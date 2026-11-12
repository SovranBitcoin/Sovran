/**
 * @fileoverview Wire shapes for the NIP-17 DM envelope transport, and the one
 * reader for an envelope's timestamp.
 *
 * Leaf module so the transport, the decryptor and the pager can share these
 * without importing each other.
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

/**
 * An envelope's `createdAt` in unix seconds, read the one way both the
 * decryptor and the pagination cursor read it. nagg returns `createdAt` as a
 * number OR a string (numeric or ISO-8601); a numeric value above the
 * milliseconds threshold is downscaled. Reading an ISO string with `Number`
 * alone gave NaN -> 0 (epoch / 1970), which is why NIP-04 message dates once
 * rendered as 1970; reading a numeric string with `Date.parse` alone gave no
 * pagination cursor.
 */
export function envelopeUnixSeconds(raw: DmEnvelope['createdAt']): number {
  if (raw instanceof Date) return Math.floor(raw.getTime() / 1000);
  if (typeof raw === 'number') {
    return raw > 1_000_000_000_000 ? Math.floor(raw / 1000) : raw;
  }
  const n = Number(raw);
  if (Number.isFinite(n)) return n > 1_000_000_000_000 ? Math.floor(n / 1000) : n;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

/** One arrival-ordered page of wraps. Paging is length-based: callers
 *  re-derive their `until` cursor from envelope `createdAt`. */
export interface DmEnvelopePage {
  envelopes: DmEnvelope[];
  hasNextPage: boolean;
  /** Wraps the backend sent, counting any that did not parse. Absent: `envelopes.length`. */
  received?: number;
}

/** Which NIP a decrypted DM arrived over. NIP-04 is legacy read-only;
 *  everything the app sends is NIP-17. */
export type DmProtocol = 'nip04' | 'nip17';
