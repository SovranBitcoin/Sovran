/**
 * The mint page's name and icon, first source that has one: the bridge's
 * NUT-06 read on the entry, what the opening screen already showed (`seed*`),
 * the stored mint metadata, then the URL. The seed and the store let the page
 * paint a known mint's name and icon on the first frame instead of the URL
 * until the bridge's fetch lands.
 */
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
