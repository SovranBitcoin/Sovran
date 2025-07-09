import { getLightningAmount, getMeltQuote, isValidEcashToken, Transaction } from 'components/cashu';

import { getGiveaway } from 'app/ecashReceiveConfirmation';
import { store } from '../redux/store';
import { decodePaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts';
import { memoizedGetBalance, memoizedGetTransactions } from '../redux/cashu';
import { nip19 } from 'nostr-tools';
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
    (tx: Transaction) =>
      tx.privkey === giveaway.private_key && tx.transactionType === 'receive' && !tx.isRefund
  );
};

interface NavigationResult {
  screen: string;
  params: Record<string, any>;
}

type HandlerResult = Result<NavigationResult | null, string>;

interface HandlePaymentRequestProps {
  request: string;
}

export const handlePaymentRequest = async ({
  request,
}: HandlePaymentRequestProps): Promise<HandlerResult> => {
  const decodedPaymentRequest = decodePaymentRequest(request);
  const receiverMints = decodedPaymentRequest.mints;
  const receiverAmount = decodedPaymentRequest.amount;
  const receiverTarget = decodedPaymentRequest.getTransport(
    PaymentRequestTransportType.NOSTR
  ).target;
  const unit = decodedPaymentRequest.unit;

  if (!receiverAmount) {
    return err('invalid_payment_request');
  }

  if (receiverMints?.length === 0) {
    return err('missing_mint');
  }

  const balances = receiverMints.map((m) => memoizedGetBalance(unit, m));

  if (balances.some((b) => b < receiverAmount)) {
    return err('insufficient_balance');
  }

  let { data } = nip19.decode(receiverTarget);
  const { pubkey } = data as { pubkey: string };
  return ok({
    screen: 'paymentRequestSendConfirmation',
    params: {
      request,
      unit,
      amount: receiverAmount,
      to: pubkey,
    },
  });
};

interface BarcodeHandlerProps {
  scanning: { data: string };
  urDecoder: URDecoder;
  unit: string;
  selectedMint: any;
  setProgress?: (progress: number) => void;
  setLoading: (loading: boolean) => void;
  setScanned?: (scanned: boolean) => void;
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
  validateBalance = true,
}: {
  data: string;
  selectedMint: any;
  unit: string;
  balance: number;
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
    const isBalanceSufficient = balance >= totalAmount;
    if (!isBalanceSufficient && validateBalance) {
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
  validateBalance = true,
}: BarcodeHandlerProps): Promise<HandlerResult> => {
  const balance = memoizedGetBalance(unit, selectedMint)(store.getState());

  if (!scanning.data.startsWith('ur:') && setScanned) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setScanned(true);
  }

  let type: 'ur' | 'ecash' | 'paymentRequest' | 'lightning';
  if (scanning.data.startsWith('ur:')) {
    type = 'ur';
  } else if (isValidEcashToken(scanning.data)) {
    type = 'ecash';
  } else if (isValidPaymentRequest(scanning.data)) {
    type = 'paymentRequest';
  } else if (
    isLightningAddress(lnTrim(scanning.data)) ||
    isLnurlp(lnTrim(scanning.data)) ||
    isLightningInvoice(lnTrim(scanning.data))
  ) {
    type = 'lightning';
  }

  switch (type) {
    case 'ur':
      if (!setProgress) {
        throw new Error('setProgress is required for handling UR');
      }
      return handleUR({ scanning, urDecoder, unit, setProgress });
    case 'ecash':
      return handleEcash({ data: scanning.data, unit });
    case 'paymentRequest':
      const decodedPaymentRequest = decodePaymentRequest(scanning.data);

      return ok({
        screen: 'currency',
        params: {
          unit: decodedPaymentRequest.unit,
          amount: decodedPaymentRequest.amount,
          mints: decodedPaymentRequest.mints,
          allowedUnits: [decodedPaymentRequest.unit?.toUpperCase()],
          paymentRequest: scanning.data,
          to: 'ecashSendConfirmation',
        },
      });
    case 'lightning':
      return handleLightning({
        data: scanning.data,
        selectedMint,
        unit,
        balance,
        setLoading,
        validateBalance,
      });
    default:
      return err('invalid_address');
  }
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
