import type { NotificationHandlerMap } from 'coco-payment-ux';

import {
  allOptionsDisabledPopup,
  balanceTooLowPopup,
  generalErrorPopup,
  missingMeltTargetPopup,
  noAmountPopup,
  noValidMintPopup,
  unsupportedInputPopup,
} from '@/shared/lib/popup';

export function createSovranNotifications(): NotificationHandlerMap {
  return {
    NO_AMOUNT: ({ code: _code, message: _message, data: _data }) => {
      noAmountPopup();
    },
    NO_VALID_MINT: ({ code: _code, message, data: _data }) => {
      noValidMintPopup({ text: message });
    },
    INSUFFICIENT_BALANCE: ({ code: _code, message, data: _data }) => {
      balanceTooLowPopup({ text: message });
    },
    NO_BALANCE: ({ code: _code, message, data: _data }) => {
      balanceTooLowPopup({ text: message });
    },
    UNSUPPORTED_INPUT: ({ code: _code, message, data: _data }) => {
      unsupportedInputPopup({ text: message });
    },
    ALL_OPTIONS_DISABLED: ({ code: _code, message: _message, data: _data }) => {
      allOptionsDisabledPopup();
    },
    MISSING_MELT_TARGET: ({ code: _code, message: _message, data: _data }) => {
      missingMeltTargetPopup();
    },
    SEND_FAILED: ({ code: _code, message, data: _data }) => {
      generalErrorPopup({ text: message });
    },
    MINT_QUOTE_FAILED: ({ code: _code, message, data: _data }) => {
      generalErrorPopup({ text: message });
    },
  };
}
