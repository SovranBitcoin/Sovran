/**
 * @fileoverview Sovran PaymentFlowProvider — thin wrapper around coco-payment-ux
 *
 * Injects Sovran-specific dependencies (wallet manager, handlers, operations,
 * notifications, mint persistence) into the coco-payment-ux PaymentFlowProvider.
 * All flow orchestration logic lives in coco-payment-ux; this file is glue.
 */

import React, { useRef } from 'react';

import type { WalletContext } from 'coco-payment-ux';
import {
  PaymentFlowProvider as CocoPaymentFlowProvider,
  type PaymentFlowProviderConfig,
} from 'coco-payment-ux/react';
import { useManager } from 'coco-cashu-react';

import { createSovranHandlers } from '@/features/send/lib/paymentHandlers';
import { createSovranNotifications } from '@/features/send/lib/notifications';
import { createSovranOperations } from '@/features/send/lib/operations';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';

// Re-export hooks from coco-payment-ux so existing imports continue to work
export {
  usePaymentFlowMachine,
  usePaymentFlowMint,
  usePaymentFlowMintContext,
} from 'coco-payment-ux/react';

export function PaymentFlowProvider({ children }: { children: React.ReactNode }) {
  const manager = useManager();
  const { keys } = useNostrKeysContext();
  const pubkeyRef = useRef(keys?.pubkey);
  pubkeyRef.current = keys?.pubkey;

  const managerRef = useRef(manager);
  managerRef.current = manager;

  const walletContextRef = useRef<WalletContext | null>(null);

  const configRef = useRef<PaymentFlowProviderConfig | null>(null);
  if (!configRef.current) {
    configRef.current = {
      createHandlers: (machine, refs) =>
        createSovranHandlers({
          machine,
          onOptionDismiss: () => refs.getOptionDismiss()?.(),
        }),
      operations: createSovranOperations({ managerRef, walletContextRef }),
      notifications: createSovranNotifications(),
      onPersistMint: (mintUrl) => {
        const pubkey = pubkeyRef.current;
        if (pubkey) {
          useMintStore.getState().setSelectedMint(pubkey, mintUrl);
        }
      },
      walletContextRef,
    };
  }

  return <CocoPaymentFlowProvider config={configRef.current}>{children}</CocoPaymentFlowProvider>;
}
