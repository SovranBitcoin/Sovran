import { sendEcash } from 'helper/cashu/pay';
import { decodePaymentRequest, getDecodedToken } from '@cashu/cashu-ts';
import { NDKEvent, NDKKind, ProfilePointer } from '@nostr-dev-kit/ndk';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { nip19, nip59 } from 'nostr-tools';
import { useSelector } from 'react-redux';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { sendGiftWrappedEncryptedDirectMessage } from 'helper/nostrClient';

export const useSendEncryptedDirectMessage = () => {
  const { ndk } = useNDK();
  const currentProfile = useSelector(memoizedGetCurrentProfile);

  const sendEncryptedDirectMessage = async ({
    message,
    recipient,
  }: {
    message: string;
    recipient: string;
  }) => {
    const privKeyBytes: Uint8Array = nip19.decode(currentProfile.nsec).data as Uint8Array;

    const directMessageEvent = {
      created_at: Math.ceil(Date.now() / 1000),
      kind: NDKKind.EncryptedDirectMessage,
      tags: [['p', recipient]],
      content: message,
    };

    const wrappedEvent = nip59.wrapEvent(directMessageEvent, privKeyBytes, recipient);

    const e = new NDKEvent(ndk, { ...wrappedEvent });

    e.publish();
  };

  const sendPaymentRequest = async ({ request }: { request: string }) => {
    const decodedRequest = decodePaymentRequest(request);

    const result = nip19.decode(decodedRequest.transport[0].target);

    const pubkey: string = (result.data as ProfilePointer).pubkey;

    const transaction = await sendEcash({
      unit: decodedRequest.unit as string,
      amount: decodedRequest.amount as number,
      to: pubkey,
    });

    const decodedToken = getDecodedToken(transaction.token);

    sendGiftWrappedEncryptedDirectMessage({
      message: JSON.stringify({
        mint: decodedToken.mint,
        unit: decodedToken.unit,
        proofs: decodedToken.proofs,
        id: decodedRequest.id,
      }),
      recipient: pubkey,
      nsec: currentProfile.nsec,
    });
  };

  return { sendEncryptedDirectMessage, sendPaymentRequest };
};
