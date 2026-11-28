/** Name and icon from the bridge's read, the caller's seed, stored metadata,
 *  then the URL, so a known mint paints on frame one, not as its URL. */
export function resolveMintInfoIdentity(
  entry: Record<string, unknown> | null | undefined,
  cached: { displayName?: string; iconUrl?: string } | undefined,
  mintUrl: string
): { displayName: string; iconUrl: string | undefined } {
  const seedName = entry?.seedDisplayName;
  const displayName =
    entry?.displayName != null
      ? String(entry.displayName)
      : typeof seedName === 'string' && seedName.length > 0
        ? seedName
        : (cached?.displayName ?? mintUrl);
  const iconUrl =
    (entry?.iconUrl as string | undefined) ??
    (entry?.seedIconUrl as string | undefined) ??
    cached?.iconUrl;
  return { displayName, iconUrl };
}
