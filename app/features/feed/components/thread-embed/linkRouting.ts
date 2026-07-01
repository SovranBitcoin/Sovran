import { validateExternalUrl } from '@/shared/lib/url';

/**
 * Decide whether a tapped link should be embedded in-thread.
 *
 * Returns the normalized URL to load in the web view, or `null` when the link
 * is not an http(s) page (`mailto:`, `tel:`, malformed, or any other scheme).
 * The caller falls back to the OS opener for `null` so non-page schemes never
 * reach the web view.
 */
export function resolveEmbedTarget(raw: string): string | null {
  const validated = validateExternalUrl(raw);
  if (validated.isErr()) return null;
  const { protocol } = validated.value;
  if (protocol !== 'http:' && protocol !== 'https:') return null;
  return validated.value.toString();
}
