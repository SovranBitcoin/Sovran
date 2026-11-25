/**
 * @fileoverview Live relay connection health from the account's Nostr client.
 *
 * Maps each pool relay's status to a small UI-facing state, updated on every
 * `relay:status` change so the relay-management screen's status dots stay
 * current. NIP-66 monitor events are out of scope; this reflects the app's
 * own live connections.
 */
import { useEffect, useState } from 'react';
import type { NostrClient, RelayHealth as ClientRelayHealth } from 'nostr/client';

import { useNostrClient } from '@/runtime/nostrClient';

export type RelayHealth = 'connected' | 'connecting' | 'disconnected' | 'failed';

const fromClient: Record<ClientRelayHealth, RelayHealth> = {
  connected: 'connected',
  connecting: 'connecting',
  flapping: 'failed',
  disconnected: 'disconnected',
};

function readHealth(client: NostrClient): Record<string, RelayHealth> {
  const next: Record<string, RelayHealth> = {};
  for (const [url, status] of Object.entries(client.getRelayHealth())) {
    next[url] = fromClient[status];
  }
  return next;
}

/** Returns a `url → health` map for the current pool relays. */
export function useRelayHealth(): Record<string, RelayHealth> {
  const { client } = useNostrClient();
  const [health, setHealth] = useState<Record<string, RelayHealth>>({});

  useEffect(() => {
    if (!client) return;
    const read = () => setHealth(readHealth(client));
    read();
    return client.on('relay:status', read);
  }, [client]);

  return health;
}
