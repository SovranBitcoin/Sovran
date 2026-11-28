import { setNostrLogger, type NostrLogger } from 'nostr';

import { log } from '@/shared/lib/logger';

let bridged = false;

/** Route the `nostr` package's structured logs into the app logger so the tier trace is visible. */
export function bridgeNostrLoggerOnce(): void {
  if (bridged) return;
  bridged = true;
  const bridge: NostrLogger = {
    debug: (event, data) => log.debug(event, data),
    info: (event, data) => log.info(event, data),
    warn: (event, data) => log.warn(event, data),
  };
  setNostrLogger(bridge);
}
