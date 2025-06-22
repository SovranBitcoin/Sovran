import NDK from '@nostr-dev-kit/ndk';

export const relays = [
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://nostr.thank.eu',
  'wss://relay.vanderwarker.family',
  'wss://nostr-relay.bitcoin.ninja',
  'wss://lnbits.btc-payserver.eu/nostrrelay/1',
  'wss://relay.damus.io',
  'wss://nostr.girino.org',
  'wss://relay.8333.space/',
  'wss://relay.snort.social',
  'wss://nostr.mutinywallet.com',
  'wss://nos.lol',
  'wss://relay.nostr.band/all',
  'wss://relay.roli.social',
  'wss://deschooling.us',
  'wss://relay-verified.deschooling.us',
  'wss://feeds.nostr.band/nostrhispano',
  'wss://search.nos.today',
  'wss://nostr-relay.app',
  'wss://nb.relay.center',
  'wss://nostrja-kari-nip50.heguro.com',
  'wss://nfdn.betanet.dotalgo.io',
  'wss://saltivka.org',
  'wss://filter.stealth.wine?broadcast=true',
  'wss://nostr.novacisko.cz',
  'wss://relay.noswhere.com',
  'wss://relay1.nostrchat.io',
  'wss://relay2.nostrchat.io',
];

const ndk = new NDK({
  explicitRelayUrls: relays,
});

ndk.connect();

export default ndk;
