import React from 'react';
import EcashComponent from './EcashComponent';
import LightningTransactionComponent from './LightningTransactionComponent';

const TransactionComponent = ({ transaction, theme, isReceived }) => {
  if (transaction.type === 'ecash') {
    return (
      <EcashComponent
        token={transaction.token}
        theme={theme}
        isReceived={isReceived}
        date={transaction.date}
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
