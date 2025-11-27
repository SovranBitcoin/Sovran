/**
 * @fileoverview Send flow currency route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * Has inline payment string processing for send-flow aware routing.
 */

import {
  getLightningAmount,
  isLightningInvoice,
  isValidEcashToken,
  lnTrim,
} from '@/helper/coco/utils';
import { Proof } from '@cashu/cashu-ts';
import { URDecoder } from '@gandlaf21/bc-ur';
import { getDecodedToken, ReceiveHistoryEntry } from 'coco-cashu-core';
import { CurrencyScreen } from 'components/screens/CurrencyScreen';
import Haptics from 'components/ui/Haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ROUTSTR_PUBKEY } from 'helper/constants';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useMelt } from 'hooks/coco';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useState } from 'react';
import { useMintStore } from 'stores/mintStore';
// import { utils as lnurlPayUtils } from 'lnurl-pay';
import { popup } from '@/helper/popup';

function ModalScreen() {
  const params = useLocalSearchParams<{
    amount?: string;
    unit: string;
    to: string;
    paymentRequest?: string;
    profile?: string;
    lud16?: string;
    allowedUnits?: string;
    mints?: string;
    lnUrlOrAddress?: string;
    routstrTopUp?: string;
  }>();
  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;
  const { createMeltQuote } = useMelt();

  const [urDecoder, setUrDecoder] = useState<URDecoder>(new URDecoder());
  const [scanned, setScanned] = useState<boolean>(false);

  // Send-flow aware payment string processing
  const processPaymentString = async (scanning: { data: string; type?: string }): Promise<void> => {
    if (!scanned || scanning.data.startsWith('ur:')) {
      setScanned(true);

      // Handle UR codes
      if (scanning.data.startsWith('ur:')) {
        if (urDecoder.isComplete() && urDecoder.isSuccess()) {
          return;
        }

        const prevPer = urDecoder.getProgress();
        urDecoder.receivePart(scanning.data);
        const nextPer = urDecoder.getProgress();

        if (prevPer !== nextPer) {
          if (nextPer < 0.33) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } else if (nextPer < 0.66) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          } else if (nextPer < 1) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }

        if (urDecoder.isComplete() && urDecoder.isSuccess()) {
          const ur = urDecoder.resultUR();
          const decoded = ur.decodeCBOR();
          const _tokenString = new TextDecoder().decode(decoded);

          // Receiving ecash - route to receive flow
          const receiveHistoryEntry: ReceiveHistoryEntry & { token: string } = {
            id: `receive-${Date.now()}`,
            type: 'receive',
            amount: getDecodedToken(_tokenString).proofs.reduce(
              (sum: number, proof: Proof) => sum + proof.amount,
              0
            ),
            unit: getDecodedToken(_tokenString).unit,
            mintUrl: getDecodedToken(_tokenString).mint,
            createdAt: Date.now(),
            metadata: {},
            token: _tokenString,
          };

          router.navigate({
            pathname: '/(receive-flow)/receiveToken',
            params: {
              receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
            },
          });

          setUrDecoder(new URDecoder());
          return;
        }
      }

      // Handle regular ecash tokens - route to receive flow
      if (isValidEcashToken(scanning.data)) {
        const receiveHistoryEntry: ReceiveHistoryEntry & { token: string } = {
          id: `receive-${Date.now()}`,
          type: 'receive',
          amount: getDecodedToken(scanning.data).proofs.reduce(
            (sum: number, proof: Proof) => sum + proof.amount,
            0
          ),
          unit: getDecodedToken(scanning.data).unit,
          mintUrl: getDecodedToken(scanning.data).mint,
          createdAt: Date.now(),
          metadata: {},
          token: scanning.data,
        };

        router.navigate({
          pathname: '/(receive-flow)/receiveToken',
          params: {
            receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
          },
        });
      } else if (
        (lnurlPayUtils.isLightningAddress(lnTrim(scanning.data)) ||
          lnurlPayUtils.isLnurlp(lnTrim(scanning.data)) ||
          isLightningInvoice(lnTrim(scanning.data))) &&
        selectedMint
      ) {
        // Lightning payment - stay in send flow
        const lnAmount = getLightningAmount(lnTrim(scanning.data));
        if (!lnAmount) {
          // No amount, update params for amount selection
          router.setParams({
            to: 'meltQuote',
            lnUrlOrAddress: lnTrim(scanning.data),
          });
          return;
        }

        const quote = await createMeltQuote(selectedMint, lnTrim(scanning.data));
        router.navigate({
          pathname: '/(send-flow)/meltQuote',
          params: {
            meltQuote: JSON.stringify(quote),
          },
        });
      } else {
        popup({ message: 'Invalid payment data', emoji: '🚨', type: 'error' });
      }
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Select Amount' }} />
      <CurrencyScreen
        params={params}
        onMintQuoteCreated={(mintHistoryEntry) => {
          // This shouldn't happen in send flow, but route to receive-flow if it does
          router.replace({
            pathname: '/(receive-flow)/mintQuote',
            params: {
              mintHistoryEntry: JSON.stringify(mintHistoryEntry),
            },
          });
        }}
        onSendTokenCreated={(sendHistoryEntry) => {
          // Navigate within send-flow (horizontal push)
          router.navigate({
            pathname: '/(send-flow)/sendToken',
            params: {
              sendHistoryEntry: JSON.stringify(sendHistoryEntry),
            },
          });
        }}
        onMeltQuoteCreated={(meltQuote) => {
          // Navigate within send-flow (horizontal push)
          router.navigate({
            pathname: '/(send-flow)/meltQuote',
            params: {
              meltQuote: JSON.stringify(meltQuote),
            },
          });
        }}
        onCameraPress={(unit) => {
          // Navigate within send-flow (horizontal push)
          router.navigate({
            pathname: '/(send-flow)/camera',
            params: { unit },
          });
        }}
        onRoutstrSuccess={() => {
          router.replace({
            pathname: '/userMessages',
            params: { pubkey: ROUTSTR_PUBKEY },
          });
        }}
        processPaymentStringFn={processPaymentString}
      />
    </>
  );
}

export default withSheetProvider(ModalScreen);
