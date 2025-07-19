import { finalizeEvent, nip44, SimplePool } from 'nostr-tools';
import { store } from 'helper/redux/store';
import { Cache } from 'react-native-cache';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { relays } from 'components/ndk';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { deriveMintBackupKeys } from 'helper/cashuClient';
import _ from 'lodash';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

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

export async function fetchEventFromRelays(
  pubKey: string,
  mnemonic: string
): Promise<string[] | null> {
  const pool = new SimplePool();

  const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(mnemonic));

  const DERIVATION_PATH = `m/44'/129372'`;
  const path = `${DERIVATION_PATH}/0'/0'/0/0`;
  const seed = root.derive(path);
  const derivedCashuMnemonic = bip39.entropyToMnemonic(seed.privateKey as Uint8Array, wordlist);

  const { privateKeyBytes, publicKeyHex } = deriveMintBackupKeys(derivedCashuMnemonic);

  try {
    const events = await pool.get(relays, {
      kinds: [30078],
      authors: [publicKeyHex],
      '#d': ['mint-list'], // Filter for the specific replaceable event
    });

    if (!events) {
      return null;
    }

    // Decrypt the content
    const conversationKey = nip44.v2.utils.getConversationKey(privateKeyBytes, publicKeyHex);
    const decryptedContent = nip44.v2.decrypt(events.content, conversationKey);

    // Parse the decrypted backup data
    const backupData = JSON.parse(decryptedContent);

    // Return the mints array
    return backupData.mints || [];
  } catch (error) {
    console.error('Error fetching or decrypting event:', error);
    return null;
  } finally {
    pool.close(relays);
  }
}

async function publishWalletEvent(mints: string[]): Promise<boolean> {
  try {
    const currentProfile = memoizedGetCurrentProfile(store.getState());

    if (!currentProfile?.nut13) {
      throw new Error('No valid nut13 set in profile');
    }

    const backupData = {
      mints: _.uniq(mints),
      timestamp: Math.floor(Date.now() / 1000),
    };

    const { privateKeyBytes, publicKeyHex } = deriveMintBackupKeys(currentProfile.nut13);
    const conversationKey = nip44.v2.utils.getConversationKey(privateKeyBytes, publicKeyHex);
    const encryptedContent = nip44.v2.encrypt(JSON.stringify(backupData), conversationKey);

    const event: NostrEvent = {
      kind: 30078,
      tags: [
        ['d', 'mint-list'], // replaceable event identifier
        ['client', 'sovran.money'],
      ],
      pubkey: publicKeyHex,
      content: encryptedContent,
      created_at: Math.floor(Date.now() / 1000),
    };

    const pool = new SimplePool();
    pool.publish(relays, finalizeEvent(event, privateKeyBytes));
    return true;
  } catch (err) {
    throw err;
  }
}

export { publishWalletEvent };
