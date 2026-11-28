import { facade } from 'nostr';

// ---------------------------------------------------------------------------
// One relay connection (one socket per relay) for everything in the facade
// that talks to the default relays: the social data layer's relay tier and the
// payment inbox. Built once per relay set and kept across data-layer rebuilds,
// so a tier toggle or an account switch does not open a second set of sockets
// beside the first, and the gift-wrap signature verdicts it remembers are not
// thrown away. Sockets open on first use and close when idle; holding the
// connection costs nothing by itself.
// ---------------------------------------------------------------------------

let shared: { key: string; connection: facade.relay.RelayConnection } | null = null;

export function sharedRelayConnection(relays: readonly string[]): facade.relay.RelayConnection {
  const key = relays.join(',');
  if (shared?.key === key) return shared.connection;
  const connection = facade.relay.createRelayPoolConnection({ relays: [...relays] });
  shared = { key, connection };
  return connection;
}
