import { SimplePool } from 'nostr-tools';
import { Cache } from 'react-native-cache';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { relays } from 'components/ndk';

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

