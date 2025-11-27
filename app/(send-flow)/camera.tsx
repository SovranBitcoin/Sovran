/**
 * @fileoverview Send flow camera route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * Has inline payment processing for send-flow aware routing.
 */

import { isValidEcashToken } from '@/helper/coco/utils';
import { Proof } from '@cashu/cashu-ts';
import { URDecoder } from '@gandlaf21/bc-ur';
import { getDecodedToken, ReceiveHistoryEntry } from 'coco-cashu-core';
import Haptics from 'components/ui/Haptics';
import { router, Stack } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
// import { utils as lnurlPayUtils } from 'lnurl-pay';
import { CameraScreen, ScanningData } from 'components/screens/CameraScreen';

const Camera: React.FC = () => {
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

            router.navigate({
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

          router.navigate({
            pathname: '/(receive-flow)/receiveToken',
            params: {
              receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
            },
          });
        }
      }
    },
    [scanned]
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Scan QR' }} />
      <CameraScreen onScan={handleScan} onReset={handleReset} />
    </>
  );
};

export default Camera;
