import { isValidEcashToken } from '@/shared/lib/cashu/utils';

/**
 * Scan a chat-message body for an embedded `cashuA…`/`cashuB…` token. Returns
 * the longest valid prefix when found, otherwise `null`. Shared across DM
 * surfaces (NIP-04, NIP-17, MLS, BitChat) so any inline ecash send renders a
 * redeem affordance regardless of transport.
 */
export function extractCashuToken(content: string): string | null {
  if (!content || typeof content !== 'string') return null;

  const lowerContent = content.toLowerCase();
  const cashuAIndex = lowerContent.indexOf('cashua');
  const cashuBIndex = lowerContent.indexOf('cashub');

  let tokenStartIndex = -1;
  if (cashuAIndex !== -1 && (cashuBIndex === -1 || cashuAIndex < cashuBIndex)) {
    tokenStartIndex = cashuAIndex;
  } else if (cashuBIndex !== -1) {
    tokenStartIndex = cashuBIndex;
  }

  if (tokenStartIndex === -1) return null;

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

  return token || null;
}
