/**
 * Context for triggering the NFC success overlay (e.g. mock button in dev).
 * Provider is rendered by the wallet tab layout; consumers (e.g. index page) use
 * useNfcSuccessOverlayMock() to trigger the overlay without a real NFC payment.
 */

import { createContext, useContext } from 'react';

export interface NfcSuccessOverlayContextValue {
  triggerMock: () => void;
}

export const NfcSuccessOverlayContext = createContext<NfcSuccessOverlayContextValue | null>(null);

export function useNfcSuccessOverlayMock(): () => void {
  const ctx = useContext(NfcSuccessOverlayContext);
  return ctx?.triggerMock ?? (() => {});
}
