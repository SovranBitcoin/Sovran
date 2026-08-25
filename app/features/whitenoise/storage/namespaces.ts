/**
 * Single source of truth for every AsyncStorage namespace Whitenoise writes
 * under. Namespaces are scoped per-account so multiple profiles can't see
 * each other's data; the per-account `wipeWhitenoiseStorage` cleanup
 * iterates `Object.values(WhitenoiseNamespace)` so a new entry below is
 * automatically covered.
 */
export const WhitenoiseNamespace = {
  GroupState: 'group-state',
  KeyPackage: 'key-package',
  InviteReceived: 'invite-received',
  InviteUnread: 'invite-unread',
  InviteSeen: 'invite-seen',
  InboxCursor: 'inbox-cursor',
  History: 'history',
  DmIndex: 'dm-index',
} as const;

export type WhitenoiseNamespace = (typeof WhitenoiseNamespace)[keyof typeof WhitenoiseNamespace];

/**
 * Build the AsyncStorage prefix shared by every key in a given namespace.
 * Pair with `AsyncStorageKVBackend` so the envelope discriminator and the
 * prefix layout stay aligned across every backend instance.
 */
export function whitenoisePrefix(accountIndex: number, namespace: WhitenoiseNamespace): string {
  return `whitenoise:${accountIndex}:${namespace}`;
}
