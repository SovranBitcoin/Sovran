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
