import React from 'react';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import Modal from 'components/layout/Modal';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { useTypedRoute, useTypedNavigation } from 'helper/navigation';
import { useCashu } from 'helper/redux/cashu';
import { EcashSendConfirmation } from './ecashSendConfirmation';
import { EcashReceiveConfirmation } from './ecashReceiveConfirmation';
import { LightningReceiveConfirmation } from './lightningReceiveConfirmation';
import { LightningSendConfirmation } from './lightningSendConfirmation';

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

  if (transaction?.transactionType === 'send' && transaction.type === 'ecash') {
    return (
      <EcashSendConfirmation
        unit={transaction.unit}
        amount={transaction.amount}
        token={transaction.token}
      />
    );
  }

  if (transaction.type === 'ecash' && transaction.transactionType === 'receive') {
    return <EcashReceiveConfirmation transaction={transaction} token={transaction.token} />;
  }

  if (transaction.type === 'lightning' && transaction.transactionType === 'receive') {
    return (
      <LightningReceiveConfirmation
        request={transaction.request}
        paymentRequest={transaction.paymentRequest}
        unit={transaction.unit}
        amount={transaction.amount}
        autoGoBackOnPaid={false}
      />
    );
  }

  if (transaction.type === 'lightning' && transaction.transactionType === 'send') {
    return (
      <LightningSendConfirmation
        transaction={transaction}
        pr={transaction.request}
        unit={transaction.unit}
        pubkey={transaction?.nostr?.pubkey}
        meltQuote={transaction.meltQuote ? JSON.stringify(transaction.meltQuote) : undefined}
        lud16={transaction.lud16}
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
