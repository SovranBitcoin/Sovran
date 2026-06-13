// ---------------------------------------------------------------------------
// Mesh transport — mint-url helpers
// ---------------------------------------------------------------------------

/** Trailing-slash + case differences must not break mint-allowlist matching. */
export function normalizeMintUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}
