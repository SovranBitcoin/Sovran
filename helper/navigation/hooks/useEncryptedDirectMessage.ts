import { sendEcash } from 'helper/cashu/pay';
import { decodePaymentRequest } from '@cashu/cashu-ts';
import { bytesToHex } from '@noble/hashes/utils';
import { NDKEvent, NDKKind, NDKPrivateKeySigner, ProfilePointer } from '@nostr-dev-kit/ndk';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { nip04, nip19 } from 'nostr-tools';
import { useSelector } from 'react-redux';

export const useSendEncryptedDirectMessage = () => {
  const { ndk } = useNDK();
  const currentProfile = useSelector(
    (state: { nostr: { currentProfile: any } }) => state.nostr.currentProfile
  );

  const sendEncryptedDirectMessage = async ({
    message,
    recipient,
  }: {
    message: string;
    recipient: string;
  }) => {
    const { data: privKeyBytes } = nip19.decode(currentProfile.nsec);
    ndk.signer = new NDKPrivateKeySigner(bytesToHex(privKeyBytes));
    const event = new NDKEvent(ndk);
    ndk.connect();
    event.kind = NDKKind.EncryptedDirectMessage;
    event.content = await nip04.encrypt(bytesToHex(privKeyBytes), recipient, message);
    event.tags = [['p', recipient]];
    event.sign();
    try {
      await event.publish();
    } catch (e) {}
  };

  const sendPaymentRequest = async ({ request }: { request: string }) => {
    const decodedRequest = decodePaymentRequest(request);

    const result = nip19.decode(decodedRequest.transport[0].target);

    const pubkey: string = (result.data as ProfilePointer).pubkey;

    await sendEcash({
      unit: decodedRequest.unit as string,
      amount: decodedRequest.amount as number,
      to: pubkey,
    });
  };

  return { sendEncryptedDirectMessage, sendPaymentRequest };
};
