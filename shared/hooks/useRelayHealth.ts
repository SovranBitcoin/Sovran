/**
 * @fileoverview Live relay connection health from the NDK pool.
 *
 * Maps each pool relay's `connectivity.status` (an `NDKRelayStatus`) to a small
 * UI-facing state. Polled on a short interval (NDK mutates status outside React)
 * so the relay-management screen's status dots stay current. NIP-66 monitor
 * events are out of scope; this reflects the app's own live connections.
 */
import { useEffect, useState } from 'react';

import { NDKRelayStatus, useNDK } from '@nostr-dev-kit/ndk-mobile';

type RelayHealth = 'connected' | 'connecting' | 'disconnected' | 'failed';

const POLL_MS = 2_000;

function mapStatus(status: NDKRelayStatus | undefined): RelayHealth {
  switch (status) {
    case NDKRelayStatus.CONNECTED:
    case NDKRelayStatus.AUTHENTICATED:
      return 'connected';
    case NDKRelayStatus.CONNECTING:
    case NDKRelayStatus.RECONNECTING:
    case NDKRelayStatus.AUTH_REQUESTED:
    case NDKRelayStatus.AUTHENTICATING:
      return 'connecting';
    case NDKRelayStatus.FLAPPING:
      return 'failed';
    default:
      return 'disconnected';
  }
}

/** Returns a `url → health` map for the current NDK pool relays. */
export function useRelayHealth(): Record<string, RelayHealth> {
  const { ndk } = useNDK();
  const [health, setHealth] = useState<Record<string, RelayHealth>>({});

  useEffect(() => {
    if (!ndk?.pool) return;
    const read = () => {
      const next: Record<string, RelayHealth> = {};
      for (const [url, relay] of ndk.pool.relays) {
        next[url] = mapStatus(relay.connectivity?.status);
      }
      setHealth(next);
    };
    read();
    const interval = setInterval(read, POLL_MS);
    return () => clearInterval(interval);
  }, [ndk]);

  return health;
}
