import { popup } from '../engine';

export function walletNotReadyPopup(): void {
  popup({
    message: 'Wallet not ready',
    text: 'Please try again.',
    icon: 'icon:mdi:wallet-outline',
    type: 'error',
  });
}

export function nfcErrorPopup(params: { title: string; message: string }): void {
  popup({ message: params.title, text: params.message, icon: 'icon:mdi:nfc-off', type: 'error' });
}

const NFC_PROGRESS_LABELS: Record<string, string> = {
  reading: 'Reading payment request…',
  selecting: 'Selecting payment method…',
  creating: 'Creating ecash token…',
  writing: 'Writing token to tag…',
};

export function nfcPaymentProgressPopup(params: { phase: string }): void {
  popup({
    message: 'Hold device steady',
    text: NFC_PROGRESS_LABELS[params.phase] ?? 'Processing NFC payment…',
    icon: 'icon:mdi:nfc',
    type: 'info',
  });
}
