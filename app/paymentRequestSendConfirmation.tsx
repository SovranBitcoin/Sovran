import React, { useState } from 'react';
import { formatCurrency } from 'helper/currency';
import { useNavigation } from 'expo-router';
import Modal from 'components/layout/Modal';
import { greys } from 'helper/colors';
import { Button } from 'components/common/Button';
import { ArrowIcon, CancelSendIcon } from 'assets/icons';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { View } from 'components/common/Themed';
import { useTypedRoute } from 'helper/navigation/index';
import { decodePaymentRequest } from '@cashu/cashu-ts';
import { useSendEncryptedDirectMessage } from 'helper/navigation/hooks/useEncryptedDirectMessage';
import { Section } from 'components/common/Section';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { TransactionHeader } from 'components/common/Transaction/TransactionHeader';

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useNavigation();
  const { request, unit, amount, to } = useTypedRoute<'paymentRequestSendConfirmation'>();
  const [loading, setLoading] = useState(false);
  const { sendPaymentRequest } = useSendEncryptedDirectMessage();

  const isSats = unit === 'sat';
  const currency = isSats ? 'BTC' : unit.toUpperCase();
  const denomination = isSats ? 'sats' : unit;

  const formatAmount = (displayDenomination) => {
    return formatCurrency(
      {
        currency,
        value: amount,
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
    await sendPaymentRequest({ request });
    setLoading(false);
  };

  const handleCancel = () => {
    navigation.navigate('Tabs', { screen: 'index' });
  };

  const transparentViewStyle = { backgroundColor: 'transparent' };
  const decodedRequest = decodePaymentRequest(request);

  return (
    <Modal
      showClose
      title="Send Payment Request"
      children={
        <View style={transparentViewStyle}>
          <TransactionHeader
            pubkey={to}
            transactionType="send"
            amount={amount}
            unit={unit}
            request={request}
          />

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
      }
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
      }
    />
  );
}

export default withSheetProvider(ModalScreen);
