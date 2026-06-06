/**
 * @fileoverview Send flow paymentRequest route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * The navigateToPaymentRequest handler navigates here with a synthetic
 * entry containing the encoded payment request.
 *
 * Validates the `paymentRequestEntry` deep-link param at the route
 * boundary per AUDIT.md dim-5 — the param is a JSON-encoded entry that
 * carries an attacker-controllable BOLT11/Cashu payment request and was
 * previously forwarded raw to the screen.
 */

import React, { useCallback } from 'react';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { z } from 'zod';

import { PaymentRequestScreen } from '@/features/send';
import { usePaymentFlowMachine } from '@sovranbitcoin/colada/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  paymentRequestEntry: z.string().min(1).max(64_000).optional(),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'send-flow.paymentRequest' });

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

  const handleRequestMintList = useCallback(() => {
    void machine.requestMintSelector();
  }, [machine]);

  if (!params) return null;

  return (
    <PaymentRequestScreen
      key={params.paymentRequestEntry}
      paymentRequestEntry={params.paymentRequestEntry}
      onCancel={() => {
        router.dismissTo('/');
      }}
      onRequestMintList={handleRequestMintList}
    />
  );
}

export default ModalScreen;
