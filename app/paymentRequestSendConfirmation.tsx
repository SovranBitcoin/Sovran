import React, { useState } from 'react';
import { formatCurrency } from 'helper/currency';
import { useNavigation } from 'expo-router';
import Modal from 'components/layout/Modal';
import { greys } from 'helper/colors';
import { Button } from 'components/common/Button';
import { ArrowIcon, CancelSendIcon } from 'assets/icons';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { View } from 'components/common/View';
import { useTypedRoute } from 'helper/navigation/index';
import { decodePaymentRequest } from '@cashu/cashu-ts';
import { useSendEncryptedDirectMessage } from 'helper/navigation/hooks/useEncryptedDirectMessage';
import { Section } from 'components/common/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/common/Transaction/TransactionHeader';
import { TransactionBuilder } from 'helper/redux/cashu';

function ModalScreen() {
  const { request, unit, amount, to } = useTypedRoute<'paymentRequestSendConfirmation'>();
  return (
    <PaymentRequestSendConfirmation
      transaction={
        new TransactionBuilder({
          request,
          unit,
          amount,
          to,
          transactionType: 'send',
        })
      }
    />
  );
}

function PaymentRequestSendConfirmation({ transaction }) {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useNavigation();
  const [loading, setLoading] = useState(false);
  const { sendPaymentRequest } = useSendEncryptedDirectMessage();

  const isSats = transaction.unit === 'sat';
  const currency = isSats ? 'BTC' : transaction.unit.toUpperCase();
  const denomination = isSats ? 'sats' : transaction.unit;

  const formatAmount = (displayDenomination) => {
    return formatCurrency(
      {
        currency,
        value: transaction.amount,
        denomination,
      },
      {
        locale: 'en-US',
        precision: displayDenomination === 'btc' ? 8 : 2,
        currencyDisplay: 'symbol',
        denomination: displayDenomination,
      }
    );
  };

  const handleSendPaymentRequest = async () => {
    setLoading(true);
    await sendPaymentRequest({ request: transaction.request });
    setLoading(false);
  };

  const handleCancel = () => {
    navigation.goBack();
  };

  const transparentViewStyle = { backgroundColor: 'transparent' };
  const decodedRequest = decodePaymentRequest(transaction.request);

  return (
    <Modal
      showClose
      title="Send Payment Request"
      buttons={
        <View style={transparentViewStyle}>
          <Button
            icon={<CancelSendIcon />}
            onPress={handleCancel}
            text="Cancel"
            position="center"
            variant="secondary"
            loading={false}
          />
          <Button
            icon={<ArrowIcon size={24} color={greys(theme)[0]} rotate={0} />}
            onPress={handleSendPaymentRequest}
            text="Send"
            position="center"
            variant="primary"
            loading={loading}
          />
        </View>
      }>
      <View style={transparentViewStyle}>
        <TransactionHeader transaction={transaction} />

        <Section
          items={[
            {
              title: `Amount (${currency})`,
              value: formatAmount(isSats ? 'btc' : unit),
            },
            {
              title: 'Amount (USD)',
              value: '≈' + formatAmount('usd'),
            },
          ]}
        />

        <Section
          items={[
            {
              title: 'Mints',
              value: decodedRequest?.mints?.join(', '),
            },
            {
              title: 'Supported Unit',
              value: decodedRequest?.unit,
            },
          ]}
        />

        <Section
          items={[
            {
              title: 'Type',
              value: 'Payment Request (ecash)',
            },
            {
              title: 'Transaction Type',
              value: 'Send',
            },
          ]}
        />
      </View>
    </Modal>
  );
}

export default withSheetProvider(ModalScreen);
