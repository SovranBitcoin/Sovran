/**
 * @fileoverview Publishes the active profile's NIP-65 relay list from Network
 * settings.
 */
import { NDKEvent } from '@nostr-dev-kit/ndk-mobile';
import type NDK from '@nostr-dev-kit/ndk-mobile';

import { log } from '@/shared/lib/logger';
import { publishEvent } from '@/shared/lib/nostr/publish';
import { DEFAULT_RELAYS } from '@/shared/lib/nostr/outbox/defaults';
import { RELAY_LIST_KIND, serializeRelayList } from '@/shared/lib/nostr/outbox/nip65';
import { getOwnWriteRelays } from '@/shared/lib/nostr/outbox/relayListStore';

export async function publishRelayList(ctx: {
  ndk: NDK;
  entries: Parameters<typeof serializeRelayList>[0];
  markPublished: (created: number) => void;
  setPublishing: (publishing: boolean) => void;
  setPublishMsg: (msg: string | null) => void;
}): Promise<void> {
  const { ndk, entries, markPublished, setPublishing, setPublishMsg } = ctx;
  setPublishing(true);
  setPublishMsg(null);
  try {
    const created = Math.floor(Date.now() / 1000);
    const event = new NDKEvent(ndk);
    event.kind = RELAY_LIST_KIND;
    event.created_at = created;
    event.tags = serializeRelayList(entries);
    const targets = [...new Set([...getOwnWriteRelays(), ...DEFAULT_RELAYS])];
    const result = await publishEvent({ ndk, event, relays: targets, resolveOn: 'all-settled' });
    if (result.isOk()) {
      markPublished(created);
      log.info('settings.relays.published', { accepted: result.value.accepted.length });
      setPublishMsg(`Published to ${result.value.accepted.length} relays.`);
    } else {
      setPublishMsg('Could not publish. Check your connection and try again.');
    }
  } finally {
    setPublishing(false);
  }
}
