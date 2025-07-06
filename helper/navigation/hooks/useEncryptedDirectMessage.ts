import { sendEcash } from 'helper/cashu/pay';
import { decodePaymentRequest, getDecodedToken } from '@cashu/cashu-ts';
import { NDKEvent, NDKKind, ProfilePointer } from '@nostr-dev-kit/ndk';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { nip19, nip59, SimplePool } from 'nostr-tools';
import { useSelector } from 'react-redux';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';

const getRelayPool = function () {
  if (!_pool) {
    _pool = new SimplePool();
    return _pool as SimplePool;
  }

  return _pool as SimplePool;
};

const relays = ['wss://relay.minibits.cash', 'wss://relay.primal.net', 'wss://relay.damus.io'];

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
    console.log(message, recipient);
    try {
      const privKeyBytes: Uint8Array = nip19.decode(currentProfile.nsec).data as Uint8Array;

      console.log(privKeyBytes);
      const directMessageEvent = {
        created_at: Math.ceil(Date.now() / 1000),
        kind: NDKKind.EncryptedDirectMessage,
        tags: [['p', recipient]],
        content: message,
      };
      console.log(directMessageEvent);

      const wrappedEvent = nip59.wrapEvent(directMessageEvent, privKeyBytes, recipient);

      const e = new NDKEvent(ndk, { ...wrappedEvent });

      e.publish();
    } catch (err) {
      console.log('ERROR123', err);
    }
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
    sendEncryptedDirectMessage({
      message: JSON.stringify({
        mint: decodedToken.mint,
        unit: decodedToken.unit,
        proofs: decodedToken.proofs,
        id: decodedRequest.id,
      }),
      recipient: pubkey,
    });
  };

  return { sendEncryptedDirectMessage, sendPaymentRequest };
};
