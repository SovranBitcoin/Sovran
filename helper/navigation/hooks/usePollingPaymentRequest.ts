import { useMemo, useEffect } from 'react';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { NDKKind } from '@nostr-dev-kit/ndk';
import { nip04, nip19 } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';
import { getEncodedToken, PaymentRequest } from '@cashu/cashu-ts';
import { checkTokenSpent, receiveEcash } from 'helper/cashuClient';
import { updateTransaction } from 'helper/redux/cashu';
import { store } from 'helper/redux/store';
import { showMessage } from 'helper/popup/popups';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';

interface PaymentRequestPayload {
  proofs: any[];
  mint: string;
  unit: string;
  id: string;
}

interface UsePollingPaymentRequestParams {
  paymentRequest: PaymentRequest;
}

export const usePollingPaymentRequest = ({ paymentRequest }: UsePollingPaymentRequestParams) => {
  const currentProfile = memoizedGetCurrentProfile(store.getState());

  const filters = useMemo(
    () => [
      {
        kinds: [NDKKind.EncryptedDirectMessage],
        '#p': [currentProfile?.pubkey],
      },
    ],
    [currentProfile?.pubkey]
  );

  const { events } = useSubscribe({
    filters,
  });

  const parseMessageForEcash = async (
    message: string
  ): Promise<boolean | PaymentRequestPayload> => {
    try {
      const payload = JSON.parse(message) as PaymentRequestPayload;
      if (payload?.mint && payload?.unit && payload?.proofs) {
        return payload;
      }
      return false;
    } catch (e) {
      return false;
    }
  };

  useEffect(() => {
    if (!currentProfile?.nsec) return;
    if (!paymentRequest) return;

    const { data: privKeyBytes } = nip19.decode(currentProfile.nsec);
    const privKey = bytesToHex(privKeyBytes);

    const decryptMessages = async () => {
      for (const event of events) {
        try {
          const decryptedMessage = await nip04.decrypt(privKey, event.pubkey, event.content);

          const ecashMessage = await parseMessageForEcash(decryptedMessage);
          if (ecashMessage && typeof ecashMessage !== 'boolean') {
            if (ecashMessage.id === paymentRequest.id) {
              await redeemEcash({
                mint: ecashMessage.mint,
                proofs: ecashMessage.proofs,
                unit: ecashMessage.unit,
                from: event.pubkey,
              });
              break;
            }
          }
        } catch (err) { }
      }
    };

    decryptMessages();
  }, [events, currentProfile?.nsec, currentProfile?.pubkey, paymentRequest?.id]);

  async function redeemEcash({
    mint,
    proofs,
    unit,
    from,
  }: {
    mint: string;
    proofs: any[];
    unit: string;
    from: string;
  }) {
    const encodedEcash = getEncodedToken(
      {
        proofs: proofs,
        mint: mint,
        unit: unit,
      },
      {
        version: 4,
      }
    );

    const spent = await checkTokenSpent({
      token: encodedEcash,
    });

    let received;
    if (spent) {
      // throw new AppError("Token already spent.", "Token already spent.");
    } else {
      const res = await receiveEcash({
        token: encodedEcash,
        unit,
        from,
      });
      if (res.isOk()) {
        received = res.value;
      } else {
        return;
      }
    }

    const profileId = memoizedGetCurrentProfile(store.getState()).id;
    await store.dispatch(
      updateTransaction({
        profileId,
        matcher: (t) => t.paymentRequest === paymentRequest.toEncodedRequest(),
        updateFn: (t) => ({
          ...t,
          paid: true,
          nostr: {
            pubkey: from,
          },
        }),
      })
    );
    showMessage('funds_received', { amount: 'Payment', unit: 'received' }, { emoji: '💰' });

    return received;
  }

  return {};
};
