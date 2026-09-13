/** Display-only public BIP-39 vector. Never passed to storage or a wallet. */
export function getBackupDemoPhrase(mockMode: boolean): string | null {
  if (!__DEV__ || !mockMode) return null;
  return 'legal winner thank year wave sausage worth useful legal winner thank yellow';
}
