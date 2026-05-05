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
  const maxTokenLength = 5000;

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
