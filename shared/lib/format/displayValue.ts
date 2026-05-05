/**
 * Pure display-formatting parser for human-recognisable protocol payloads
 * (npub, lnbc1, cashuA/B, creqA, BIP-21 with lightning+cashu, lud16-shaped
 * email handles). UI primitives consume the discriminated result and render
 * it without re-implementing prefix detection.
 */

export type DisplayValueLayout =
  | { kind: 'prefix-split'; prefix: 'npub' | 'lnbc1' | 'cashuA' | 'cashuB' | 'creqA'; body: string }
  | { kind: 'email'; username: string; domain: string }
  | { kind: 'bitcoin-uri'; value: string }
  | { kind: 'plain'; value: string };

const PREFIXES_GATED: readonly ('npub' | 'lnbc1' | 'cashuA' | 'cashuB')[] = [
  'npub',
  'lnbc1',
  'cashuA',
  'cashuB',
];

/**
 * Detect a display layout for `raw`. `special` mirrors DetailsList's existing
 * gate — when false, only inputs whose protocol-shape is unambiguous regardless
 * of context (creqA, BIP-21 lightning+cashu) are recognised. The npub / lnbc1 /
 * cashuA / cashuB / email recognisers stay gated to avoid e.g. a profile name
 * 'cashuB my shop' rendering as a truncated cashu token.
 */
export function formatDisplayValue(raw: unknown, special: boolean): DisplayValueLayout {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { kind: 'plain', value: String(raw ?? '') };
  }

  if (special && raw.includes('@')) {
    const at = raw.indexOf('@');
    const username = raw.slice(0, at);
    const domain = raw.slice(at + 1);
    if (username.length > 0 && domain.length > 0) {
      return { kind: 'email', username, domain };
    }
  }

  if (raw.startsWith('creqA')) {
    const body = raw.slice('creqA'.length);
    if (body.length > 0) return { kind: 'prefix-split', prefix: 'creqA', body };
  }

  if (raw.startsWith('bitcoin:?lightning=') && raw.includes('&cashu=')) {
    return { kind: 'bitcoin-uri', value: raw };
  }

  if (special) {
    for (const prefix of PREFIXES_GATED) {
      if (raw.startsWith(prefix)) {
        const body = raw.slice(prefix.length);
        if (body.length > 0 && !body.startsWith(' ')) {
          return { kind: 'prefix-split', prefix, body };
        }
      }
    }
  }

  return { kind: 'plain', value: raw };
}
