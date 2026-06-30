import { isValidEcashToken } from 'wallet';

import { cashuLog } from '@/shared/lib/logger';

/**
 * Scan a chat-message body for an embedded `cashuA…`/`cashuB…` token. Returns
 * the longest valid prefix when found, otherwise `null`. Shared across DM
 * surfaces (NIP-04, NIP-17, MLS, BitChat) so any inline ecash send renders a
 * redeem affordance regardless of transport.
 */
export function extractCashuToken(content: string): string | null {
  if (!content || typeof content !== 'string') {
    cashuLog.debug('chat.ecash_token.extract.result', {
      reason: 'empty',
      contentLength: typeof content === 'string' ? content.length : null,
      found: false,
    });
    return null;
  }

  const lowerContent = content.toLowerCase();
  const cashuAIndex = lowerContent.indexOf('cashua');
  const cashuBIndex = lowerContent.indexOf('cashub');

  let tokenStartIndex = -1;
  if (cashuAIndex !== -1 && (cashuBIndex === -1 || cashuAIndex < cashuBIndex)) {
    tokenStartIndex = cashuAIndex;
  } else if (cashuBIndex !== -1) {
    tokenStartIndex = cashuBIndex;
  }

  if (tokenStartIndex === -1) {
    cashuLog.debug('chat.ecash_token.extract.result', {
      reason: 'no-prefix',
      contentLength: content.length,
      found: false,
    });
    return null;
  }

  const remainingText = content.slice(tokenStartIndex);
  let token = '';
  // P2PK-locked proofs carry ~150-byte JSON secrets (vs 64-hex plain), so a
  // many-proof locked token comfortably exceeds the old 5000-char cap.
  const maxTokenLength = 10000;

  // Fast path: a Nut Drop message body IS the token (no trailing prose), so
  // try the whole run up to the first whitespace before the O(n²) per-char
  // scan — that loop decodes the candidate on every iteration.
  const whitespaceMatch = /\s/.exec(remainingText);
  const wholeCandidate = remainingText
    .slice(0, whitespaceMatch ? whitespaceMatch.index : remainingText.length)
    .slice(0, maxTokenLength);
  if (wholeCandidate.length > 6 && isValidEcashToken(wholeCandidate)) {
    cashuLog.info('chat.ecash_token.extract.result', {
      reason: 'whole-candidate',
      contentLength: content.length,
      tokenLength: wholeCandidate.length,
      prefixKind: wholeCandidate.slice(0, 6).toLowerCase(),
      found: true,
    });
    return wholeCandidate;
  }

  for (let i = 6; i <= Math.min(remainingText.length, maxTokenLength); i++) {
    const candidate = remainingText.slice(0, i);
    if (isValidEcashToken(candidate)) {
      token = candidate;
    } else if (token) {
      break;
    }

    if (/\s/.test(remainingText[i]) && !token) {
      break;
    }
  }

  if (token) {
    cashuLog.info('chat.ecash_token.extract.result', {
      reason: 'incremental-candidate',
      contentLength: content.length,
      tokenLength: token.length,
      prefixKind: token.slice(0, 6).toLowerCase(),
      found: true,
    });
    return token;
  }

  cashuLog.debug('chat.ecash_token.extract.result', {
    reason: 'invalid-candidate',
    contentLength: content.length,
    prefixKind: remainingText.slice(0, 6).toLowerCase(),
    found: false,
  });
  return null;
}
