/**
 * @fileoverview Resolves the merged ComposeConfig for the active rails.
 *
 * Opens immediately with the synchronous default (composer never waits on a
 * relay), then tightens the char budget once the write relays' NIP-11 limits
 * resolve. Only the Nostr rail exists today; the merge is ready for more.
 */
import { useEffect, useState } from 'react';

import { useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';
import { mergeRailCapabilities } from '@/features/composer/config/merge';
import { buildNostrRail, defaultNostrRail } from '@/features/composer/config/nostrRail';
import type { ComposeConfig } from '@/features/composer/config/types';

export function useComposeConfig(): ComposeConfig {
  const [config, setConfig] = useState<ComposeConfig>(() =>
    mergeRailCapabilities([defaultNostrRail()])
  );

  const writeRelaysKey = useRelayListStore((s) =>
    s.entries
      .filter((e) => e.write)
      .map((e) => e.url)
      .sort()
      .join(',')
  );

  useEffect(() => {
    let active = true;
    const writeRelays = writeRelaysKey.length > 0 ? writeRelaysKey.split(',') : [];
    void buildNostrRail(writeRelays).then((rail) => {
      if (active) setConfig(mergeRailCapabilities([rail]));
    });
    return () => {
      active = false;
    };
  }, [writeRelaysKey]);

  return config;
}
