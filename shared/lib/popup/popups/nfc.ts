import { popup } from '../engine';

export function walletNotReadyPopup(): void {
  popup({
    message: 'Wallet not ready',
    text: 'Please try again.',
    icon: 'icon:solar:wallet-bold',
    type: 'error',
  });
}

export function nfcErrorPopup(params: { title: string; message: string }): void {
  popup({ message: params.title, text: params.message, icon: 'icon:lucide:nfc', type: 'error' });
}
