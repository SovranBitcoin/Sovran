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

  let overrideButtons: ButtonHandlerButton[] | undefined;

  if (transaction?.nostr?.pubkey) {
    overrideButtons = [
      {
        text: 'View Messages',
        variant: 'secondary',
        onPress: () => {
          navigation.goBack();
          navigation.navigate('userMessages', {
            pubkey: transaction.nostr.pubkey,
          });
        },
      },
    ];
      <EcashSendConfirmation
        unit={transaction.unit}
        amount={transaction.amount}
        token={transaction.token}
        overrideButtons={overrideButtons}
      />
    );
  }

  if (transaction.type === 'ecash' && transaction.transactionType === 'receive') {
      <EcashReceiveConfirmation
        token={transaction.token}
        overrideButtons={overrideButtons}
      />
  }

  if (transaction.type === 'lightning' && transaction.transactionType === 'receive') {
    return (
      <LightningReceiveConfirmation
        request={transaction.request}
        paymentRequest={transaction.paymentRequest}
        unit={transaction.unit}
        amount={transaction.amount}
        autoGoBackOnPaid={false}
        overrideButtons={overrideButtons}
      />
    );
  }

  if (transaction.type === 'lightning' && transaction.transactionType === 'send') {
    return (
      <LightningSendConfirmation
        overrideButtons={overrideButtons}
        pr={transaction.request}
        unit={transaction.unit}
        pubkey={transaction?.nostr?.pubkey}
        meltQuote={transaction.meltQuote ? JSON.stringify(transaction.meltQuote) : undefined}
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
