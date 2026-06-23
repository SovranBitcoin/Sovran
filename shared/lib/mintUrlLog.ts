/**
 * Canonical log-field helper for mint URLs.
 *
 * A mint URL can be sensitive context, so payment/mint logs record only its
 * presence and length, never the value. This is the single owner — every
 * surface that logs mint context imports it rather than redefining the shape,
 * so the redaction contract stays identical everywhere.
 */
export function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}
