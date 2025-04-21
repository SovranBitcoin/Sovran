import { finalizeEvent, nip19, SimplePool } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';
import { store } from 'helper/redux/store';
import { Cache } from 'react-native-cache';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

const cache = new Cache({
  namespace: 'last-wallet-event',
  policy: {
    maxEntries: 50,
    stdTTL: 60 * 5, // 5 minutes
  },
  backend: AsyncStorage,
});

interface NostrEvent {
  kind: number;
  tags: string[][];
  pubkey: string;
  content: string;
  created_at: number;
}

export async function fetchEventFromRelays(pubKey: string): Promise<Event[] | null> {
  return null;
  const pool = new SimplePool();
  try {
    const events = await pool.get(relays, {
      kinds: [37375],
      authors: [pubKey],
    });
    return events;
  } catch (error) {
  } finally {
    pool.close(relays);
  }
  return null;
}

async function publishWalletEvent(
  mints: string[],
  units: string[] = ['sat', 'usd']
): Promise<string>[] {
  try {
    const currentProfile = store.getState().nostr?.currentProfile;

    if (!currentProfile?.pubkey || !currentProfile?.nsec) {
      throw new Error('No valid profile available');
    }

    const pubKey = currentProfile.pubkey;
    const { data: privKeyBytes } = nip19.decode(currentProfile.nsec);

    if (!(privKeyBytes instanceof Uint8Array)) {
      throw new Error('Invalid private key format');
    }

    const event: NostrEvent = {
      kind: 37375,
      tags: [
        ['d', 'my-cashu-wallet'],
        ...mints
          .filter((item, index, self) => index === self.findIndex((t) => t === item))
          .map((mint) => ['mint', mint]),
        ['name', 'Cashu Wallet'],
        ['unit', 'sat'],
        ['description', 'Mobile Cashu wallet'],
        ...relays
          .filter((item, index, self) => index === self.findIndex((t) => t === item))
          .map((relay) => ['relay', relay]),
        ['alt', 'Cashu mobile wallet'],
      ],
      pubkey: pubKey,
      content: '', // You might want to add encrypted content here using nip44
      created_at: Math.floor(Date.now() / 1000),
    };

    const pool = new SimplePool();
    return await pool.publish(relays, finalizeEvent(event, privKeyBytes));
  } catch (err) {
    throw err;
  }
}

export { publishWalletEvent };
