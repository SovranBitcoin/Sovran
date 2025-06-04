import React from 'react';
import { useSelector } from 'react-redux';
import { View, ScrollView } from 'react-native';
import Container from 'components/layout/Container';
import { Text } from 'components/common/Themed';
import { Button } from 'components/common/Button';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { useTransactions } from 'components/providers/TransactionsProvider';
import { Transaction } from 'components/layout/Transaction';

export default function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const { activeConnections = [], transactions = [], listenToTransaction } = useTransactions();

  const connectionsWithTx = activeConnections.map((conn: any) => {
    const reqs = String(conn.id).split('_');
    const txs = transactions.filter((tx: any) => tx.request && reqs.includes(tx.request));
    return { id: conn.id, txs };
  });

  const openPendingLightning = () => {
    const pendingLightning = transactions.filter(
      (tx: any) => tx.type === 'lightning' && tx.transactionType === 'receive' && !tx.paid
    );
    if (pendingLightning.length) {
      listenToTransaction(pendingLightning);
    }
  };

  return (
    <Container>
      <ScrollView>
        <Text style={{ color: greys(theme)[0], fontFamily: 'OverpassBold', marginBottom: 12 }}>
          Open Connections: {activeConnections.length}
        </Text>
        <Button
          variant="primary"
          text="Open Pending Lightning"
          onPress={openPendingLightning}
          style={{ marginBottom: 16 }}
        />
        {connectionsWithTx.map(({ id, txs }) => (
          <View key={id} style={{ marginBottom: 24 }}>
            <Text
              style={{ color: greys(theme)[0], fontFamily: 'OverpassBold', marginBottom: 8 }}>
              {id}
            </Text>
            {txs.map((tx: any) => (
              <Transaction
                key={tx.request || tx.token || tx.id || tx.txid}
                tx={tx}
                transactions={txs}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </Container>
  );
}
