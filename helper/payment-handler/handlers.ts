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
import Haptics from 'components/common/Haptics';
import { isLightningAddress, isLightningInvoice, isLnurlp, lnTrim } from 'helper/third-party/lnurl';
import { ok, err, Result } from 'neverthrow';

interface NavigationResult {
  screen: string;
  params: Record<string, any>;
}

type HandlerResult = Result<NavigationResult | null, Error>;

interface BarcodeHandlerProps {
  scanning: { data: string };
  urDecoder: URDecoder;
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
    const tokenString = new TextDecoder().decode(decoded);
    setProgress(0);
    return ok({
      screen: 'ecashReceiveConfirmation',
      params: {
        token: tokenString,
        unit,
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
  if (giveaway?.id) {
    if (checkIfAlreadyRedeemed(data)) {
      return err(new Error('already_redeemed'));
    }
    const error = giveaway.error();
    if (!giveaway.condition() && error) {
      return err(new Error('general_error'));
    }
  }
  return ok({
    screen: 'ecashReceiveConfirmation',
    params: {
      token: data,
      unit,
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
    return ok({
      screen: 'lightningSendConfirmation',
      params: {
        pr: lnurl,
        amount: unit === 'sat' ? amount : amount * 100,
        meltQuote: JSON.stringify(meltQuote),
        unit,
      },
    });
  }
  return ok(null);
};

function handlePaymentRequest({ data }: { data: string }): HandlerResult {
  const decodedPaymentRequest = decodePaymentRequest(data);

  return ok({
    screen: 'currency',
    params: {
      unit: decodedPaymentRequest.unit,
      amount:
        decodedPaymentRequest.amount === undefined
          ? 0
          : decodedPaymentRequest.unit === 'sat'
            ? decodedPaymentRequest.amount
            : decodedPaymentRequest.amount / 100,
      mints: decodedPaymentRequest.mints,
      allowedUnits: [decodedPaymentRequest.unit?.toUpperCase()],
      paymentRequest: data,
      to: 'ecashSendConfirmation',
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
export const barcodeHandler = async (
  props: BarcodeHandlerProps & { navigation: any }
): Promise<HandlerResult> => {
  const { navigation, ...handlerProps } = props;

  if (!navigation.isFocused()) {
    return ok(null);
  }

  const result = await handleBarcode(handlerProps);
  if (result.isOk()) {
    const value = result.value;
    if (value) {
      navigation.navigate(value.screen, value.params, {
        closeCurrentAndParent: true,
      });
    }
    return ok(null);
  }

  return err(result.error);
};
