/**
 * Unified recent-contact row shape. Lives in its own module so the
 * `useNip17RecentContacts` hook and the mock-data store can both depend on it
 * without importing each other (the hook produces these rows; the store seeds
 * mock ones). Kept identical to the legacy hook so `ContactsScreen`, the
 * split-bill picker, and `mockDataStore` are unaffected.
 */
import type { DmProtocol } from '../data/dmDecryptPipeline';

export interface RecentContact {
  type: 'contact';
  dmEvent: { content: string } | null | undefined;
  nip17Content: string | undefined;
  pubkey: string;
  timestamp: number;
  isDefault?: boolean;
  /** Which protocol this conversation is on. Absent rows default to NIP-17. */
  protocol?: DmProtocol | 'whitenoise';
}
