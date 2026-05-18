export function shouldShowMintOfflineWarning(
  entry: { state: string },
  mintWasOffline: boolean | undefined
): boolean {
  return mintWasOffline === true && entry.state !== 'finalized' && entry.state !== 'rolledBack';
}
