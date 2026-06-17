export {
  DEFAULT_RELAYS,
  MAX_WRITE_RELAYS,
  normalizeRelayList,
  safeNormalizeRelay,
} from '@/shared/lib/nostr/outbox/defaults';
export {
  RELAY_LIST_KIND,
  parseRelayList,
  serializeRelayList,
  readRelays,
  writeRelays,
  type RelayListEntry,
} from '@/shared/lib/nostr/outbox/nip65';
export {
  resolveWriteRelays,
  type RecipientRelays,
  type ResolveWriteRelaysInput,
} from '@/shared/lib/nostr/outbox/resolveWriteRelays';
export {
  useRelayListStore,
  getOwnWriteRelays,
  type RelayListSource,
} from '@/shared/lib/nostr/outbox/relayListStore';
export { seedPool } from '@/shared/lib/nostr/outbox/seedPool';
export {
  getRecipientReadRelays,
  resolveOutboxRelays,
  type OutboxInput,
} from '@/shared/lib/nostr/outbox/recipientRelays';
