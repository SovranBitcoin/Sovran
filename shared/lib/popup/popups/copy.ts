import { popup } from './engine';
import type { PopupOverrides } from './types';

const COPY_CONFIGS = {
  token: {
    title: 'Token Copied',
    text: 'Ecash token has been copied to your clipboard.',
  },
  paymentRequest: {
    title: 'Payment Request Copied',
    text: 'Payment request has been copied to your clipboard.',
  },
  lightningInvoice: {
    title: 'Lightning Invoice Copied',
    text: 'Lightning invoice has been copied to your clipboard.',
  },
  address: {
    title: 'Address Copied',
    text: 'Address has been copied to your clipboard.',
  },
  mintUrl: {
    title: 'Mint URL Copied',
    text: 'Mint URL has been copied to your clipboard.',
  },
  p2pk: {
    title: 'P2PK Key Copied',
    text: 'P2PK public key has been copied to your clipboard.',
  },
  npub: {
    title: 'NPUB Copied',
    text: 'Nostr public key has been copied to your clipboard.',
  },
  nsec: {
    title: 'NSEC Copied',
    text: 'Nostr secret key has been copied to your clipboard.',
  },
  mnemonic: {
    title: 'Mnemonic Copied',
    text: 'Recovery phrase has been copied to your clipboard.',
  },
  cashuMnemonic: {
    title: 'Cashu Mnemonic Copied',
    text: 'Cashu recovery phrase has been copied to your clipboard.',
  },
  publicKey: {
    title: 'Public Key Copied',
    text: 'Public key has been copied to your clipboard.',
  },
  nip05: {
    title: 'NIP-05 Copied',
    text: 'NIP-05 address has been copied to your clipboard.',
  },
  lud16: {
    title: 'Lightning Address Copied',
    text: 'Lightning address has been copied to your clipboard.',
  },
} as const;

export type CopyTarget = keyof typeof COPY_CONFIGS;

export function copyPopup(target: CopyTarget, overrides?: PopupOverrides): void {
  const config = COPY_CONFIGS[target];
  popup({ message: config.title, text: config.text, type: 'success', ...overrides });
}
