import { finalizeEvent, SimplePool, nip19 } from 'nostr-tools';
import { getDecodedToken } from '@cashu/cashu-ts';
import { store } from 'helper/redux/store';

const relays = [
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
];

function convertToHex(pubkey: string): string {
  if (!pubkey) return '';
  if (pubkey.startsWith('npub')) {
    const { data } = nip19.decode(pubkey);
    return typeof data === 'string' ? data : '';
  }
  if (pubkey.startsWith('02') && pubkey.length === 66) {
    return pubkey.slice(2);
  }
  return pubkey;
}

export async function sendNutzap({
  token,
  recipient,
  content = '',
}: {
  token: string;
  recipient: string;
  content?: string;
}): Promise<void> {
  try {
    const { nostr } = store.getState() as any;
    const currentProfile = nostr?.currentProfile;
    if (!currentProfile?.pubkey || !currentProfile?.nsec) return;
    const senderPub = convertToHex(currentProfile.pubkey);
    const { data: privKeyBytes } = nip19.decode(currentProfile.nsec);
    if (!(privKeyBytes instanceof Uint8Array)) return;

    const decoded = getDecodedToken(token);
    const event = {
      kind: 9321,
      tags: [
        ...decoded.proofs.map((p: any) => ['proof', JSON.stringify(p)]),
        ['u', decoded.mint],
        ['p', convertToHex(recipient)],
      ],
      pubkey: senderPub,
      content,
      created_at: Math.floor(Date.now() / 1000),
    } as any;

    const pool = new SimplePool();
    await pool.publish(relays, finalizeEvent(event, privKeyBytes));
    pool.close(relays);
  } catch (e) {
    console.error('sendNutzap failed', e);
  }
}
