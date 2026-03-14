import type { WalletContext } from '../types';
import { debugLog } from '../debugLog';
import type { FlowContext, Destination } from './types';

// ---------------------------------------------------------------------------
// Mint Availability — re-exported for wallet UI consumption
// ---------------------------------------------------------------------------

export type MintAvailabilityStatus = 'available' | 'disabled';

export type MintAvailabilityReason =
  | 'NOT_IN_PAYMENT_REQUEST'
  | 'INSUFFICIENT_BALANCE'
  | 'NO_BALANCE'
  | 'UNSUPPORTED_FOR_FLOW';

export interface MintAvailability {
  mintUrl: string;
  balance: number;
  status: MintAvailabilityStatus;
  reason: MintAvailabilityReason | null;
  isPreferred: boolean;
}

export interface MintResolutionContext {
  trustedMints: MintAvailability[];
  validMints: MintAvailability[];
  selectedMintUrl?: string;
  amount?: number;
  destination?: Destination;
  supportedMintUrls?: string[];
}

// ---------------------------------------------------------------------------
// Build availability for a single mint
// ---------------------------------------------------------------------------

function buildMintAvailability(args: {
  mintUrl: string;
  balance: number;
  selectedMintUrl?: string;
  supportedMintUrls?: string[];
  amount?: number;
  destination?: Destination;
}): MintAvailability {
  const { mintUrl, balance, selectedMintUrl, supportedMintUrls, amount, destination } = args;

  if (supportedMintUrls?.length && !supportedMintUrls.includes(mintUrl)) {
    return {
      mintUrl,
      balance,
      status: 'disabled',
      reason: 'NOT_IN_PAYMENT_REQUEST',
      isPreferred: selectedMintUrl === mintUrl,
    };
  }

  const needsBalance =
    destination === 'paymentRequest' || destination === 'meltQuote' || destination === 'sendEcash';

  if (needsBalance && amount != null && amount > 0) {
    if (balance <= 0) {
      return {
        mintUrl,
        balance,
        status: 'disabled',
        reason: 'NO_BALANCE',
        isPreferred: selectedMintUrl === mintUrl,
      };
    }
    if (balance < amount) {
      return {
        mintUrl,
        balance,
        status: 'disabled',
        reason: 'INSUFFICIENT_BALANCE',
        isPreferred: selectedMintUrl === mintUrl,
      };
    }
  } else if (needsBalance && balance <= 0) {
    return {
      mintUrl,
      balance,
      status: 'disabled',
      reason: 'NO_BALANCE',
      isPreferred: selectedMintUrl === mintUrl,
    };
  }

  return {
    mintUrl,
    balance,
    status: 'available',
    reason: null,
    isPreferred: selectedMintUrl === mintUrl,
  };
}

// ---------------------------------------------------------------------------
// selectMintContext — reads directly from FlowContext
// ---------------------------------------------------------------------------

export function selectMintContext(
  flowCtx: FlowContext | null,
  walletCtx: WalletContext
): MintResolutionContext | null {
  if (!flowCtx?.destination) {
    debugLog({
      location: 'coco-payment-ux.selectMintContext',
      message: 'selectMintContext — no destination, returning null',
      phase: 'entry',
      data: { hasFlowCtx: !!flowCtx },
    });
    return null;
  }

  const { destination, amount, supportedMintUrls, mintUrl } = flowCtx;
  const selectedMintUrl = mintUrl ?? walletCtx.preferredMintUrl;
  debugLog({
    location: 'coco-payment-ux.selectMintContext',
    message: 'selectMintContext computed',
    phase: 'entry',
    data: {
      destination,
      selectedMintUrl: selectedMintUrl ?? null,
      flowMintUrl: mintUrl ?? null,
      preferredMintUrl: walletCtx.preferredMintUrl ?? null,
    },
  });

  const trustedMints = walletCtx.trustedMintUrls
    .map((url) =>
      buildMintAvailability({
        mintUrl: url,
        balance: walletCtx.mintBalances[url] ?? 0,
        selectedMintUrl,
        supportedMintUrls,
        amount,
        destination,
      })
    )
    .sort((a, b) => {
      if (a.status === 'available' && b.status === 'disabled') return -1;
      if (a.status === 'disabled' && b.status === 'available') return 1;
      return b.balance - a.balance;
    });

  return {
    trustedMints,
    validMints: trustedMints.filter((m) => m.status === 'available'),
    selectedMintUrl,
    amount,
    destination,
    supportedMintUrls,
  };
}
