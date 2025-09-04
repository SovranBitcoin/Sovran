import { getPublicKey, nip19 } from 'nostr-tools';
import NDK, { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { fetchEventFromRelays } from 'helper/nostr/cashu';
import * as nip06 from 'nostr-tools/nip06';
import { relays } from 'components/ndk';

export const fetchAccountData = async ({ nsec }: { nsec: string }) => {
  let { data: sk } = nip19.decode(nsec);
  const pk = getPublicKey(sk as Uint8Array);
  const npub = nip19.npubEncode(pk);

  const signer = new NDKPrivateKeySigner(nsec);
  const ndk = new NDK({
    signer: signer,
    explicitRelayUrls: relays,
  });

  await ndk.connect();

  const profile = ndk.getUser({ npub });
  return { profile: await profile.fetchProfile(), pubkey: pk, npub, nsec };
};

export async function getProfile({
  mnemonic,
  accountIndex,
}: {
  mnemonic: string;
  accountIndex: number;
}) {
  const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(
    mnemonic,
    undefined,
    accountIndex
  );

  let nsec = nip19.nsecEncode(sk);
  const profileData = await fetchAccountData({ nsec });

  if (profileData?.profile?.created_at) {
    // Pass both pubKey and mnemonic to decrypt the mint data
    const mints = await fetchEventFromRelays(pk, mnemonic);

    return {
      ...profileData,
      mints: mints || [], // Ensure mints is always an array
      mnemonic,
      id: accountIndex,
      nsec,
    };
  } else {
    return null;
  }
}
