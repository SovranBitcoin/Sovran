/**
 * @fileoverview Send flow camera route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * Has inline payment processing for send-flow aware routing.
 */

import React, { useState, useCallback, useRef } from 'react';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useMelt } from '@/hooks/coco';
import { URDecoder } from '@gandlaf21/bc-ur';
import Haptics from 'components/ui/Haptics';
import { getDecodedToken, ReceiveHistoryEntry } from 'coco-cashu-core';
import { Proof } from '@cashu/cashu-ts';
import { getLightningAmount, isValidEcashToken, lnTrim } from '@/helper/coco/utils';
// import { utils as lnurlPayUtils } from 'lnurl-pay';
import { CameraScreen, ScanningData } from 'components/screens/CameraScreen';

const Camera: React.FC = () => {
  const { unit } = useLocalSearchParams<{ unit: string }>();
  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;
  const { createMeltQuote } = useMelt();

  const urDecoderRef = useRef<URDecoder>(new URDecoder());
  const [scanned, setScanned] = useState<boolean>(false);

  const handleReset = useCallback(() => {
    setScanned(false);
    urDecoderRef.current = new URDecoder();
  }, []);

  const handleScan = useCallback(
    async (scanning: ScanningData) => {
      if (!scanned || scanning.data.startsWith('ur:')) {
        setScanned(true);

        // Handle UR codes
        if (scanning.data.startsWith('ur:')) {
          const urDecoder = urDecoderRef.current;
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

            // Receiving ecash - route to receive flow (different modal)
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

            router.push({
              pathname: '/(receive-flow)/receiveToken',
              params: {
                receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
              },
            });

            urDecoderRef.current = new URDecoder();
            return;
          }
        }

        // Handle regular ecash tokens - route to receive flow (different modal)
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

          router.push({
            pathname: '/(receive-flow)/receiveToken',
            params: {
              receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
            },
          });
        } else if (
          false
          // (lnurlPayUtils.isLightningAddress(lnTrim(scanning.data)) ||
          //   lnurlPayUtils.isLnurlp(lnTrim(scanning.data)) ||
          //   isLightningInvoice(lnTrim(scanning.data))) &&
          // selectedMint
        ) {
          // Lightning payments - stay in send flow
          const amount = getLightningAmount(lnTrim(scanning.data));
          if (!amount) {
            // Go back to currency with updated params
            router.back();
            router.setParams({
              to: 'meltQuote',
              lnUrlOrAddress: lnTrim(scanning.data),
            });
            return;
          }

          const quote = await createMeltQuote(selectedMint, lnTrim(scanning.data));
          router.push({
            pathname: '/(send-flow)/meltQuote',
            params: {
              meltQuote: JSON.stringify(quote),
            },
          });
        }
      }
    },
    [scanned, unit, selectedMint, createMeltQuote]
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Scan QR' }} />
      <CameraScreen onScan={handleScan} onReset={handleReset} />
    </>
  );
};

export default Camera;
