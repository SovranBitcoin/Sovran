// ---------------------------------------------------------------------------
// Intent Resolution
//
// Maps a ParsedPaymentInput to a ResolvedIntent. When a single payment
// option exists, resolves directly. When multiple options exist, annotates
// them and returns a chooseOption intent. Non-payment inputs (mint URL,
// npub) resolve to their own intents.
// ---------------------------------------------------------------------------

import { annotateOptions } from './annotate';
import type {
  ParsedPaymentInput,
  PaymentOption,
  Detectors,
  WalletContext,
  ResolvedIntent,
  AnnotatedOption,
} from './types';

// ---------------------------------------------------------------------------
// Single-option intent mapping
// ---------------------------------------------------------------------------

function resolveForSingleOption(option: PaymentOption, detectors: Detectors): ResolvedIntent {
  switch (option.kind) {
    case 'ecashToken':
      return { type: 'receiveToken', option };

    case 'paymentRequest': {
      const info = detectors.getPaymentRequestInfo(option.value);
      return {
        type: 'sendPaymentRequest',
        option,
        info: info ?? { mints: [], amount: undefined, unit: 'sat' },
      };
    }

    case 'lightningInvoice':
      return { type: 'meltLightningInvoice', option };

    case 'lightningAddress':
      return { type: 'meltLightningAddress', option };

    case 'lnurlp':
      return { type: 'meltLnurlp', option };

    case 'onchainAddress':
      return { type: 'meltOnchainAddress', option };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function resolveIntent(
  parsed: ParsedPaymentInput,
  detectors: Detectors,
  ctx?: WalletContext
): ResolvedIntent {
  if (parsed.errors.length > 0) {
    return {
      type: 'ignore',
      reason: {
        code: 'UNSUPPORTED_INPUT',
        message: parsed.errors[0],
      },
    };
  }

  // Multiple options → chooseOption (annotated when wallet context is available)
  if (parsed.options.length > 1) {
    const annotated: AnnotatedOption[] = ctx
      ? annotateOptions(parsed.options, ctx, detectors)
      : parsed.options.map((option) => ({
          option,
          status: 'available' as const,
          reason: null,
        }));

    return { type: 'chooseOption', options: annotated };
  }

  // Single option → direct intent
  if (parsed.options.length === 1) {
    return resolveForSingleOption(parsed.options[0], detectors);
  }

  // Non-payment intents
  if (parsed.type === 'mintUrl' && parsed.mintUrl) {
    return { type: 'openMint', url: parsed.mintUrl };
  }

  if (parsed.type === 'npub' && parsed.npub) {
    return { type: 'openProfile', npub: parsed.npub };
  }

  // BIP-321 with no supported option
  if (parsed.type === 'bip321') {
    return {
      type: 'ignore',
      reason: {
        code: 'UNSUPPORTED_INPUT',
        message: 'Bitcoin URI contained no supported payment option',
      },
    };
  }

  return { type: 'ignore', reason: { code: 'UNSUPPORTED_INPUT', message: 'Unsupported input' } };
}
