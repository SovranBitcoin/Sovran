/**
 * @fileoverview The unified recent-contact row.
 *
 * Leaf module: `mockDataStore` builds these rows and `useNip17RecentContacts`
 * consumes the store, so the shape cannot live in the hook.
 */
import type { DmProtocol } from './dmEnvelopeTypes';

/** Unified recent-contact row shape (kept identical to the legacy hook so
 *  `ContactsScreen`, the split-bill picker, and `mockDataStore` are unaffected). */
export interface RecentContact {
  type: 'contact';
  dmEvent: { content: string } | null | undefined;
  nip17Content: string | undefined;
  pubkey: string;
  timestamp: number;
  isDefault?: boolean;
  /** Which protocol this conversation is on. Absent rows default to NIP-17. */
  protocol?: DmProtocol | 'whitenoise';
  /** Newest message's event id — dev-only source-badge key; absent for
   *  default/mock rows (no badge renders). */
  newestMessageId?: string;
}
