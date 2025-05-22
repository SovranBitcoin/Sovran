import React from 'react';
import EcashTransactionComponent from './EcashTransactionComponent';
import LightningTransactionComponent from './LightningTransactionComponent';

interface Props {
  transaction: any;
  theme: string;
  isReceived: boolean;
}

const TransactionComponent = ({ transaction, theme, isReceived }: Props) => {
  if (transaction?.type === 'ecash') {
    return (
      <EcashTransactionComponent
        transaction={transaction}
        theme={theme}
        isReceived={isReceived}
      />
    );
  }

  return (
    <LightningTransactionComponent
      transaction={transaction}
      theme={theme}
      isReceived={isReceived}
    />
  );
};

export default TransactionComponent;
