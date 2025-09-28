import { View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Modal from 'components/blocks/Modal';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useTypedRoute, useTypedNavigation } from 'helper/navigation';
import { useCashu } from 'helper/redux/cashu';
import { EcashSendConfirmation } from './ecashSendConfirmation';
import { EcashReceiveConfirmation } from './ecashReceiveConfirmation';
import { LightningReceiveConfirmation } from './lightningReceiveConfirmation';
import { LightningSendConfirmation } from './lightningSendConfirmation';
import { TransferRow } from 'components/blocks/TransferRow';
import { ScrollView } from 'react-native';
import { Section } from 'components/ui/Section';
// useTypedNavigation is already imported; removing duplicate

function VirtualBatchTransaction({ batchId }: { batchId: string }) {
  const { transactions } = useCashu();
  const navigation = useTypedNavigation();

  const batchTxs = (transactions || []).filter(
    (t) => t.batchId === batchId && t.type === 'lightning'
  );

  const receivesByRequest = new Map<string, any>();
  const sendsByRequest = new Map<string, any>();

  for (const tx of batchTxs) {
    if (tx.transactionType === 'receive' && tx.request) {
      receivesByRequest.set(tx.request, tx);
    } else if (tx.transactionType === 'send' && tx.request) {
      sendsByRequest.set(tx.request, tx);
    }
  }

  const pairs = Array.from(receivesByRequest.entries())
    .map(([request, receiveTx]) => {
      const sendTx = sendsByRequest.get(request);
      if (!sendTx) return null;
      const status: 'success' | 'pending' | 'error' | undefined = receiveTx.paid
        ? 'success'
        : receiveTx.isCancel
          ? 'error'
          : 'pending';

      return {
        fromMint: sendTx.mintUrl as string,
        toMint: receiveTx.mintUrl as string,
        amount: receiveTx.amount,
        unit: receiveTx.unit,
        status,
        request,
      };
    })
    .filter(Boolean) as {
    fromMint: string;
    toMint: string;
    amount: number;
    unit: string;
    status?: 'success' | 'pending' | 'error';
    request: string;
  }[];

  return (
    <Modal showClose title="Reallocation">
      <View style={{ marginBottom: 12 }}>
        <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
          {pairs.length === 0 ? (
            <Text>No paired transactions found for this batch.</Text>
          ) : (
            pairs.map((p) => (
              <View style={{ marginHorizontal: 16 }} key={p.request}>
                <TransferRow
                  fromMint={p.fromMint}
                  toMint={p.toMint}
                  amount={p.amount}
                  unit={p.unit}
                  status={p.status}
                  leftCta={{
                    label: 'View Invoice',
                    onPress: () =>
                      navigation.navigate('transaction', {
                        id: p.request,
                        transactionType: 'send',
                      }),
                  }}
                  rightCta={{
                    label: 'View Invoice',
                    onPress: () =>
                      navigation.navigate('transaction', {
                        id: p.request,
                        transactionType: 'receive',
                      }),
                  }}
                />
              </View>
            ))
          )}
          <Section
            style={{ marginTop: 12 }}
            items={[
              { title: 'Type', value: 'Reallocation' },
              { title: 'Transfers', value: String(pairs.length) },
              { title: 'Batch', value: batchId },
            ]}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

function ModalScreen() {
  const { id, transactionType } = useTypedRoute<'modal'>();
  const { transactions } = useCashu();

  if (typeof id === 'string' && id.startsWith('batch:')) {
    const batchId = id.replace('batch:', '');
    return <VirtualBatchTransaction batchId={batchId} />;
  }

  const transaction = transactions.find(
    (t) =>
      t.txid === id ||
      String(t.id) === String(id) ||
      (t.request && t.request === id && t.transactionType === transactionType) ||
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
