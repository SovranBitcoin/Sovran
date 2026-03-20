/**
 * Ephemeral extras for coco-payment-ux screen actions while the receive flow is mounted
 * (e.g. camera permission gate for scan QR). Read via `useReceivePaymentUXExtras` in
 * `useScreenActions` from `coco-payment-ux/react`.
 */

import React, { createContext, useContext, useMemo } from 'react';

export interface ReceivePaymentUXExtrasValue {
  requestCameraPermission: () => Promise<boolean>;
}

const ReceivePaymentUXExtrasContext = createContext<ReceivePaymentUXExtrasValue | null>(null);

export function ReceivePaymentUXExtrasProvider({
  requestCameraPermission,
  children,
}: {
  requestCameraPermission: () => Promise<boolean>;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ requestCameraPermission }), [requestCameraPermission]);

  return (
    <ReceivePaymentUXExtrasContext.Provider value={value}>
      {children}
    </ReceivePaymentUXExtrasContext.Provider>
  );
}

export function useReceivePaymentUXExtras(): ReceivePaymentUXExtrasValue | null {
  return useContext(ReceivePaymentUXExtrasContext);
}
