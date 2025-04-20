import { getPublicKey, nip19 } from 'nostr-tools';
import NDK, { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { fetchEventFromRelays } from 'helper/nostr/cashu';
import * as nip06 from 'node_modules/nostr-tools/lib/cjs/nip06';

export const fetchAccountData = async ({ nsec }) => {
  let { data: sk } = nip19.decode(nsec);
  const pk = getPublicKey(sk);
  const npub = nip19.npubEncode(pk);

  const signer = new NDKPrivateKeySigner(nsec);
  const ndk = new NDK({
    signer: signer,
    explicitRelayUrls: [
      'wss://relay.primal.net',
      'wss://relay.damus.io',
      'wss://relay.8333.space/',
      'wss://relay.snort.social',
      'wss://nostr.mutinywallet.com',
      'wss://nos.lol',
    ],
  });

  await ndk.connect();

  const profile = ndk.getUser({ npub });
  return { profile: await profile.fetchProfile(), pubkey: pk, npub, nsec };
};

export async function getProfile({ mnemonic, accountIndex }) {
  const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(
    mnemonic,
    undefined,
    accountIndex
  );

  let nsec = nip19.nsecEncode(sk);
  const profileData = await fetchAccountData({ nsec });

  if (profileData?.profile?.created_at) {
    const mintsInfo = await fetchEventFromRelays(pk);

    const mints = mintsInfo?.tags.filter((tag) => tag[0] === 'mint').map((tag) => tag[1]) || [];

    return { ...profileData, mints, mnemonic, id: accountIndex, nsec };
  } else {
    return null;
  }
}
