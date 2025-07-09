import { getLightningAmount, getMeltQuote, isValidEcashToken } from 'components/cashu';

import { getGiveaway } from 'app/ecashReceiveConfirmation';
import { store } from '../redux/store';
import { decodePaymentRequest } from '@cashu/cashu-ts';
import { memoizedGetTransactions, TransactionData } from '../redux/cashu';
import { URDecoder } from '@gandlaf21/bc-ur';
import Haptics from 'components/common/Haptics';
import { isLightningAddress, isLightningInvoice, isLnurlp, lnTrim } from 'helper/third-party/lnurl';
import { isValidPaymentRequest } from '../cashu/helper';
import { ok, err, Result } from 'neverthrow';

export const checkIfAlreadyRedeemed = (token: string): boolean => {
  const profileId = store.getState().nostr?.currentProfile?.id;
  const transactions = memoizedGetTransactions({ id: profileId })(store.getState());

  const giveaway = getGiveaway({ token });
  if (!giveaway) return false;

  return transactions.some(
    (tx: TransactionData) =>
      tx.privkey === giveaway.private_key && tx.transactionType === 'receive' && !tx.isRefund
  );
};

interface NavigationResult {
  screen: string;
  params: Record<string, any>;
}

type HandlerResult = Result<NavigationResult | null, string>;

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
      return err('already_redeemed');
    }
    const error = giveaway.error();
    if (!giveaway.condition() && error) {
      return err('general_error');
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
  setLoading,
}: {
  data: string;
  selectedMint: any;
  unit: string;
  balance?: number;
  setLoading: (loading: boolean) => void;
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
    const meltQuote = await getMeltQuote({
      pr: lnurl,
      unit,
      mintUrl: selectedMint,
    });
    const totalAmount = amount + meltQuote.fee_reserve;
    if (balance !== undefined && balance < totalAmount) {
      return err('insufficient_balance');
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

export const handleBarcode = async ({
  scanning,
  urDecoder,
  unit,
  selectedMint,
  setProgress,
  setLoading,
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
    const decodedPaymentRequest = decodePaymentRequest(scanning.data);
    console.log({ decodedPaymentRequest });

    return ok({
      screen: 'currency',
      params: {
        unit: decodedPaymentRequest.unit,
        amount:
          decodedPaymentRequest.unit === 'sat'
            ? decodedPaymentRequest.amount
            : decodedPaymentRequest.amount / 100,
        mints: decodedPaymentRequest.mints,
        allowedUnits: [decodedPaymentRequest.unit?.toUpperCase()],
        paymentRequest: scanning.data,
        to: 'ecashSendConfirmation',
      },
    });
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
      setLoading,
    });
  }
  return err('invalid_address');
};

// Wrapper function to maintain current navigation behavior
export const barcodeHandler = async (
  props: BarcodeHandlerProps & { navigation: any }
): Promise<Result<void, string>> => {
  const { navigation, ...handlerProps } = props;

  if (!navigation.isFocused()) {
    return ok(undefined);
  }

  const result = await handleBarcode(handlerProps);
  if (result.isOk()) {
    const value = result.value;
    if (value) {
      navigation.navigate(value.screen, value.params, {
        closeCurrentAndParent: true,
      });
    }
    return ok(undefined);
  }

  return err(result.error);
};
