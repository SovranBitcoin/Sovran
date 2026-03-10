import type { MintHistoryEntry, ReceiveHistoryEntry, SendHistoryEntry } from 'coco-cashu-core';
import type { DisplayCurrency } from '@/shared/stores/global/settingsStore';

export type InputMode = 'sats' | 'fiat';
export type SendMode = 'offline' | 'online';

export type SendModeDebugInfo = {
  title: string;
  message: string;
};

export type OfflineSendabilityState = {
  reachableSums: number[];
  reachableAmounts: Set<number>;
  totalReadyBalance: number;
};

export const CURRENCY_CONFIG: Record<DisplayCurrency, { symbol: string; label: string }> = {
  usd: { symbol: '$', label: 'USD' },
  eur: { symbol: '€', label: 'EUR' },
  gbp: { symbol: '£', label: 'GBP' },
};

export interface CurrencyScreenParams {
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
  selectedMintUrl?: string;
  allowedMints?: string;
}

export interface CurrencyScreenProps {
  params: CurrencyScreenParams;
  onMintQuoteCreated: (mintHistoryEntry: MintHistoryEntry) => void;
  onSendTokenCreated: (
    sendHistoryEntry: SendHistoryEntry,
    options?: { nostrSent?: boolean }
  ) => void;
  onMeltQuoteReady: (lnUrlOrAddress: string, amount: number) => void;
  onCameraPress: (unit: string) => void;
  onReceiveTokenScanned?: (receiveHistoryEntry: ReceiveHistoryEntry) => void;
  onRoutstrSuccess?: () => void;
  onDone?: () => void;
  processPaymentStringFn?: (scanning: { data: string; type?: string }) => Promise<unknown>;
  onInsufficientBalance?: (amount: number, unit: string) => void;
  onSendModeChange?: (mode: SendMode | null) => void;
  onSendModeDebugChange?: (info: SendModeDebugInfo | null) => void;
}
