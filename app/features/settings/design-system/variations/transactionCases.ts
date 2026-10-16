/** What a transaction row has to be able to say. Plain data, no wallet types. */
export interface TransactionCase {
  readonly direction: 'in' | 'out';
  readonly rail: 'ecash' | 'lightning' | 'onchain';
  readonly state: 'pending' | 'done' | 'failed' | 'cancelled';
  readonly sats: number;
  /** The same amount in the display currency, already formatted. */
  readonly fiat: string;
  /** A person or business, when one is known. */
  readonly who?: string;
  readonly memo?: string;
  /** Locked to a key (P2PK). */
  readonly locked?: boolean;
  /** Short absolute time, already formatted. */
  readonly time: string;
  /** How long ago, already formatted. */
  readonly ago: string;
}

export const TRANSACTION_CASES: readonly { label: string; item: TransactionCase }[] = [
  {
    label: 'Received, ecash, from a person',
    item: {
      direction: 'in',
      rail: 'ecash',
      state: 'done',
      sats: 21_000,
      fiat: '$17.49',
      who: 'Ana Souza',
      memo: 'Lunch',
      time: '2:07 PM',
      ago: '3 min ago',
    },
  },
  {
    label: 'Sent, Lightning, to a business',
    item: {
      direction: 'out',
      rail: 'lightning',
      state: 'done',
      sats: 4_500,
      fiat: '$3.75',
      who: 'Café Imaginário',
      time: '11:42 AM',
      ago: '2 h ago',
    },
  },
  {
    label: 'Sending, ecash, not yet claimed',
    item: {
      direction: 'out',
      rail: 'ecash',
      state: 'pending',
      sats: 1_430,
      fiat: '$1.19',
      time: '9:15 AM',
      ago: '5 h ago',
    },
  },
  {
    label: 'Receiving, on-chain, confirming',
    item: {
      direction: 'in',
      rail: 'onchain',
      state: 'pending',
      sats: 250_000,
      fiat: '$208.20',
      time: 'Yesterday',
      ago: '1 d ago',
    },
  },
  {
    label: 'Sent, ecash, locked to a key',
    item: {
      direction: 'out',
      rail: 'ecash',
      state: 'done',
      sats: 8_400,
      fiat: '$7.00',
      who: 'Kwame',
      locked: true,
      time: 'Oct 5',
      ago: '2 d ago',
    },
  },
  {
    label: 'Failed, Lightning',
    item: {
      direction: 'out',
      rail: 'lightning',
      state: 'failed',
      sats: 12_000,
      fiat: '$9.99',
      who: 'npub1x9…k2f',
      time: 'Oct 4',
      ago: '3 d ago',
    },
  },
  {
    label: 'Cancelled, ecash returned',
    item: {
      direction: 'out',
      rail: 'ecash',
      state: 'cancelled',
      sats: 4_200,
      fiat: '$3.50',
      time: 'Oct 3',
      ago: '4 d ago',
    },
  },
  {
    label: 'Received, large, no name',
    item: {
      direction: 'in',
      rail: 'lightning',
      state: 'done',
      sats: 1_250_000,
      fiat: '$1,041.00',
      time: 'Sep 28',
      ago: '9 d ago',
    },
  },
];

/** `21,000` — digits only; the variant decides how to mark the unit. */
export function formatSats(sats: number): string {
  return sats.toLocaleString('en-US');
}
