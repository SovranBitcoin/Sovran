import { MintKeys, MintKeyset, Proof } from '@cashu/cashu-ts';
import { MintInfo } from '@cashu/cashu-ts/lib/types/model/MintInfo';

export interface TransactionData {
  id?: string;
  txid?: string;
  request?: string;
  token?: string;
  unit: string;
  amount: number;
  date: string | Date;
  transactionType: 'send' | 'receive' | string;
  type?: string;
  isBuy?: string;
  isSell?: boolean;
  paid?: boolean;
  isCancel?: boolean;
  unifiedRequest?: string;
  paymentRequest?: string;
  from?: string;
  to?: string;
  fromNIP05?: string;
  status?: { block_time: number;[key: string]: any };
  nostr?: { pubkey: string;[key: string]: any };
  mintUrl?: string;

  isSend?: boolean;
  isReceive?: boolean;

  mintQuote?: unknown;
}

export interface CashuProfile {
  selectedMint?: string;
  mints: string[];
  proofs: Record<string, Proof[]>;
  keysets: Record<string, MintKeyset[]>;
  transactions: TransactionData[];
  counters: Record<string, Record<string, number>>;
}

export interface CashuState {
  profiles: CashuProfile[];
  keysets: Record<string, MintKeyset[]>;
  keys: Record<string, MintKeys[]>;
  info: Record<string, MintInfo>;
  audits: Record<string, any>;
  allocation: Record<string, Record<string, number>>;
}
