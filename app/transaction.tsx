import React from 'react';
import { View, Text } from 'components/common/Themed';
import Modal from 'components/layout/Modal';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { useTypedRoute, useTypedNavigation } from 'helper/navigation';
import { useCashu } from 'helper/redux/cashu';
import { EcashSendConfirmation } from './ecashSendConfirmation';
import { EcashReceiveConfirmation } from './ecashReceiveConfirmation';
import { LightningReceiveConfirmation } from './lightningReceiveConfirmation';
import { LightningSendConfirmation } from './lightningSendConfirmation';
import type { ButtonHandlerButton } from 'components/common/ButtonHandler';

function ModalScreen() {
  const { id, transactionType } = useTypedRoute<'modal'>();
  const navigation = useTypedNavigation();
  const { transactions } = useCashu();

  const transaction = transactions.find(
    (t) =>
      t.txid === id ||
      String(t.id) === String(id) ||
      (t.request && t.request === id) ||
      (t.token && t.token === id && t.transactionType === transactionType)
  );

  if (!transaction) {
    return (
      <Modal showClose>
        <View>
          <Text>Transaction not found</Text>
        </View>
      </Modal>
    );
  }

  const extraButtons: ButtonHandlerButton[] = [];

  if (transaction?.nostr?.pubkey) {
    extraButtons.push({
      text: 'View Chat',
      variant: 'secondary',
      onPress: () => {
        navigation.goBack();
        navigation.navigate('userMessages', {
          pubkey: transaction.nostr.pubkey,
        });
      },
    });
  }

  if (transaction.request && !transaction.paid) {
    extraButtons.push({
      text: 'Open Invoice',
      variant: 'secondary',
      onPress: () => {
        navigation.navigate('lightningReceiveConfirmation', {
          unit: transaction.unit,
          request: transaction.request,
          amount: transaction.amount,
          transaction: JSON.stringify(transaction),
          unifiedRequest: transaction.unifiedRequest,
          paymentRequest: transaction.paymentRequest,
        });
      },
    });
  }

  if (
    transaction.type === 'ecash' &&
    !transaction.paid &&
    transaction.transactionType === 'send'
  ) {
    extraButtons.push({
      text: 'Open Invoice',
      variant: 'secondary',
      onPress: () => {
        navigation.navigate('ecashSendConfirmation', {
          unit: transaction.unit,
          token: transaction.token,
          amount: transaction.amount,
        });
      },
    });
  }

  if (transaction.type === 'ecash' && transaction.transactionType === 'send') {
    return (
      <EcashSendConfirmation
        unit={transaction.unit}
        amount={transaction.amount}
        token={transaction.token}
        extraButtons={extraButtons}
      />
    );
  }

  if (transaction.type === 'ecash' && transaction.transactionType === 'receive') {
    return (
      <EcashReceiveConfirmation token={transaction.token} extraButtons={extraButtons} />
    );
  }

  if (transaction.type === 'lightning' && transaction.transactionType === 'receive') {
    return (
      <LightningReceiveConfirmation
        request={transaction.request}
        paymentRequest={transaction.paymentRequest}
        unit={transaction.unit}
        amount={transaction.amount}
        autoGoBackOnPaid={false}
        extraButtons={extraButtons}
      />
    );
  }

  if (transaction.type === 'lightning' && transaction.transactionType === 'send') {
    return (
      <LightningSendConfirmation
        pr={transaction.request}
        unit={transaction.unit}
        pubkey={transaction?.nostr?.pubkey}
        meltQuote={transaction.mintQuote ? JSON.stringify(transaction.mintQuote) : undefined}
        extraButtons={extraButtons}
      />
    );
  }

  return (
    <Modal showClose>
      <View>
        <Text>Unsupported transaction type</Text>
      </View>
    </Modal>
  );
}

export default withSheetProvider(ModalScreen);
