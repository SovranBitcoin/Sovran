import {
  checkIfAlreadyRedeemed,
  getLightningAmount,
  getMeltQuote,
  isValidEcashToken,
  isValidPaymentRequest,
} from 'helper/cashuClient';

import { getGiveaway } from 'app/ecashReceiveConfirmation';
import { decodePaymentRequest } from '@cashu/cashu-ts';
import { URDecoder } from '@gandlaf21/bc-ur';
import Haptics from 'components/ui/Haptics';
import { isLightningAddress, isLightningInvoice, isLnurlp, lnTrim } from 'helper/third-party/lnurl';
import { ok, err, Result } from 'neverthrow';
import { router } from 'expo-router';
import type { MeltHistoryEntry, SendHistoryEntry, ReceiveHistoryEntry } from 'coco-cashu-core';

interface NavigationResult {
  screen: string;
  params: Record<string, any>;
}

type HandlerResult = Result<NavigationResult | null, Error>;

interface BarcodeHandlerProps {
  scanning: { data: string };
  urDecoder?: URDecoder;
  unit: string;
  selectedMint: any;
  setProgress?: (progress: number) => void;
  setLoading: (loading: boolean) => void;
  setScanned?: (scanned: boolean) => void;
  balance?: number;
}

const handleUR = async ({
  scanning,
  urDecoder,
  unit,
  setProgress,
}: {
  scanning: { data: string };
  urDecoder: URDecoder;
  unit: string;
  setProgress: (progress: number) => void;
}): Promise<HandlerResult> => {
  const prevPer = urDecoder.getProgress();
  urDecoder.receivePart(scanning.data);
  const nextPer = urDecoder.getProgress();
  setProgress(nextPer);
  if (prevPer !== nextPer) {
    if (nextPer < 0.33) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (nextPer < 0.66) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else if (nextPer < 1) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }
  if (urDecoder.isComplete() && urDecoder.isSuccess()) {
    const ur = urDecoder.resultUR();
    const decoded = ur.decodeCBOR();
    const _tokenString = new TextDecoder().decode(decoded);
    setProgress(0);
    // Create a receive history entry for ecash receive
    const receiveHistoryEntry: ReceiveHistoryEntry & { token: string } = {
      id: `receive-${Date.now()}`,
      type: 'receive',
      amount: 0, // Will be calculated from token
      unit: unit,
      mintUrl: '', // Will be extracted from token
      createdAt: Date.now(),
      metadata: {},
      token: _tokenString,
    };

    return ok({
      screen: 'ecashReceiveConfirmation',
      params: {
        receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
      },
    });
  }
  return ok(null);
};

const handleEcash = async ({
  data,
  unit,
}: {
  data: string;
  unit: string;
}): Promise<HandlerResult> => {
  const giveaway = getGiveaway({ token: data });
  if (giveaway && 'id' in giveaway) {
    if (checkIfAlreadyRedeemed(data)) {
      return err(new Error('already_redeemed'));
    }
    const error = 'error' in giveaway ? (giveaway as any).error() : null;
    if ('condition' in giveaway && !(giveaway as any).condition() && error) {
      return err(new Error('general_error'));
    }
  }
  // Create a receive history entry for ecash receive
  const receiveHistoryEntry: ReceiveHistoryEntry & { token: string } = {
    id: `receive-${Date.now()}`,
    type: 'receive',
    amount: 0, // Will be calculated from token
    unit: unit,
    mintUrl: '', // Will be extracted from token
    createdAt: Date.now(),
    metadata: {},
    token: data,
  };

  return ok({
    screen: 'ecashReceiveConfirmation',
    params: {
      receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
    },
  });
};

const handleLightning = async ({
  data,
  selectedMint,
  unit,
  balance,
}: {
  data: string;
  selectedMint: any;
  unit: string;
  balance?: number;
}): Promise<HandlerResult> => {
  const lnurl = lnTrim(data);
  const amount = getLightningAmount({ pr: lnurl });
  if (!amount) {
    return ok({
      screen: 'currency',
      params: {
        to: 'lightningSendConfirmation',
        lud16: lnurl,
        unit,
      },
    });
  }

  if (amount) {
    const meltQuoteRes = await getMeltQuote({
      pr: lnurl,
      unit,
      mintUrl: selectedMint,
    });
    if (meltQuoteRes.isErr()) {
      return err(meltQuoteRes.error);
    }
    const meltQuote = meltQuoteRes.value;
    const totalAmount = amount + meltQuote.fee_reserve;
    if (balance !== undefined && balance < totalAmount) {
      return err(new Error('insufficient_balance'));
    }
    // Create a melt history entry for Lightning send
    const meltHistoryEntry: MeltHistoryEntry = {
      id: `melt-${Date.now()}`,
      type: 'melt',
      amount: unit === 'sat' ? amount : amount * 100,
      unit: unit,
      mintUrl: selectedMint,
      createdAt: Date.now(),
      state: 'UNPAID',
      quoteId: meltQuote.quote,
      metadata: {},
    };

    return ok({
      screen: 'lightningSendConfirmation',
      params: {
        meltHistoryEntry: JSON.stringify(meltHistoryEntry),
      },
    });
  }
  return ok(null);
};

function handlePaymentRequest({ data }: { data: string }): HandlerResult {
  const decodedPaymentRequest = decodePaymentRequest(data);

  // Create a send history entry for ecash send with payment request
  const sendHistoryEntry: SendHistoryEntry = {
    id: `send-${Date.now()}`,
    type: 'send',
    amount:
      decodedPaymentRequest.amount === undefined
        ? 0
        : decodedPaymentRequest.unit === 'sat'
          ? decodedPaymentRequest.amount
          : decodedPaymentRequest.amount / 100,
    unit: decodedPaymentRequest.unit || 'sat',
    mintUrl: decodedPaymentRequest.mints?.[0] || '',
    createdAt: Date.now(),
    token: {
      mint: decodedPaymentRequest.mints?.[0] || '',
      unit: decodedPaymentRequest.unit || 'sat',
      proofs: [],
    },
    metadata: {},
  };

  return ok({
    screen: 'ecashSendConfirmation',
    params: {
      sendHistoryEntry: JSON.stringify(sendHistoryEntry),
    },
  });
}

export const handleBarcode = async ({
  scanning,
  urDecoder,
  unit,
  selectedMint,
  setProgress,
  setScanned,
  balance,
}: BarcodeHandlerProps): Promise<HandlerResult> => {
  if (!scanning.data.startsWith('ur:') && setScanned) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setScanned(true);
  }

  if (scanning.data.startsWith('ur:')) {
    if (!setProgress) {
      throw new Error('setProgress is required for handling UR');
    }
    if (!urDecoder) {
      throw new Error('urDecoder is required for handling UR');
    }
    return handleUR({ scanning, urDecoder, unit, setProgress });
  } else if (isValidEcashToken(scanning.data)) {
    return handleEcash({ data: scanning.data, unit });
  } else if (isValidPaymentRequest(scanning.data)) {
    return handlePaymentRequest({ data: scanning.data });
  } else if (
    isLightningAddress(lnTrim(scanning.data)) ||
    isLnurlp(lnTrim(scanning.data)) ||
    isLightningInvoice(lnTrim(scanning.data))
  ) {
    return handleLightning({
      data: scanning.data,
      selectedMint,
      unit,
      balance,
    });
  }
  return err(new Error('invalid_address'));
};

// Wrapper function to maintain current navigation behavior
export const barcodeHandler = async (props: BarcodeHandlerProps): Promise<HandlerResult> => {
  const result = await handleBarcode(props);
  if (result.isOk()) {
    const value = result.value;
    if (value) {
      router.push({
        pathname: `/${value.screen}` as any,
        params: value.params,
      });
    }
    return ok(null);
  }

  return err(result.error);
};
