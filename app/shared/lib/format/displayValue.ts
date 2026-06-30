/**
 * Pure display-formatting parser for human-recognisable protocol payloads
 * (npub, lnbc1, cashuA/B, creqA, BIP-21 with lightning+cashu, lud16-shaped
 * email handles). UI primitives consume the discriminated result and render
 * it without re-implementing prefix detection.
 */

import { paymentLog } from '@/shared/lib/logger';

type DisplayValueLayout =
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

function logDisplayValueResult(
  result: DisplayValueLayout,
  context: { rawLength: number; special: boolean; reason: string }
): DisplayValueLayout {
  paymentLog.debug('format.display_value.result', {
    kind: result.kind,
    special: context.special,
    reason: context.reason,
    rawLength: context.rawLength,
    prefix: result.kind === 'prefix-split' ? result.prefix : null,
    bodyLength: result.kind === 'prefix-split' ? result.body.length : null,
    usernameLength: result.kind === 'email' ? result.username.length : null,
    domainLength: result.kind === 'email' ? result.domain.length : null,
    valueLength:
      result.kind === 'plain' || result.kind === 'bitcoin-uri' ? result.value.length : null,
  });
  return result;
}

/**
 * Detect a display layout for `raw`. `special` mirrors DetailsList's existing
 * gate — when false, only inputs whose protocol-shape is unambiguous regardless
 * of context (creqA, BIP-21 lightning+cashu) are recognised. The npub / lnbc1 /
 * cashuA / cashuB / email recognisers stay gated to avoid e.g. a profile name
 * 'cashuB my shop' rendering as a truncated cashu token.
 */
export function formatDisplayValue(raw: unknown, special: boolean): DisplayValueLayout {
  if (typeof raw !== 'string' || raw.length === 0) {
    const value = String(raw ?? '');
    return logDisplayValueResult(
      { kind: 'plain', value },
      { rawLength: value.length, special, reason: 'non-string-or-empty' }
    );
  }

  if (special && raw.includes('@')) {
    const at = raw.indexOf('@');
    const username = raw.slice(0, at);
    const domain = raw.slice(at + 1);
    if (username.length > 0 && domain.length > 0) {
      return logDisplayValueResult(
        { kind: 'email', username, domain },
        { rawLength: raw.length, special, reason: 'email' }
      );
    }
  }

  if (raw.startsWith('creqA')) {
    const body = raw.slice('creqA'.length);
    if (body.length > 0) {
      return logDisplayValueResult(
        { kind: 'prefix-split', prefix: 'creqA', body },
        { rawLength: raw.length, special, reason: 'creq-prefix' }
      );
    }
  }

  if (raw.startsWith('bitcoin:?lightning=') && raw.includes('&cashu=')) {
    return logDisplayValueResult(
      { kind: 'bitcoin-uri', value: raw },
      { rawLength: raw.length, special, reason: 'bitcoin-uri' }
    );
  }

  if (special) {
    for (const prefix of PREFIXES_GATED) {
      if (raw.startsWith(prefix)) {
        const body = raw.slice(prefix.length);
        if (body.length > 0 && !body.startsWith(' ')) {
          return logDisplayValueResult(
            { kind: 'prefix-split', prefix, body },
            { rawLength: raw.length, special, reason: 'gated-prefix' }
          );
        }
      }
    }
  }

  return logDisplayValueResult(
    { kind: 'plain', value: raw },
    { rawLength: raw.length, special, reason: 'plain' }
  );
}
