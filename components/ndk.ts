import NDK, { NDKEvent } from '@nostr-dev-kit/ndk';

const relays = [
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://nostr.thank.eu',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.vanderwarker.family',
  'wss://nostr-relay.bitcoin.ninja',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://lnbits.btc-payserver.eu/nostrrelay/1',
  'wss://relay.damus.io',
  'wss://nostr.girino.org',
  'wss://relay.8333.space/',
  'wss://relay.snort.social',
  'wss://nostr.mutinywallet.com',
  'wss://nos.lol',
];

const ndk = new NDK({
  explicitRelayUrls: relays,
});

ndk.connect();

export default ndk;
