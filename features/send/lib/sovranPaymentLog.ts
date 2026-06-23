/**
 * Shared log-field helper for the Sovran payment-config modules.
 *
 * A mint URL can be sensitive context, so payment logs record only its
 * presence and length, never the value. Shared by the operations,
 * notifications, and handler modules so the redaction shape stays identical
 * across every payment log line.
 */
export function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}
