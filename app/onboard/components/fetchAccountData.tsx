import { getPublicKey, nip19 } from 'nostr-tools';
import NDK, { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
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
