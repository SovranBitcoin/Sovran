import { View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Modal from 'components/blocks/Modal';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useLocalSearchParams } from 'expo-router';
import { router } from 'expo-router';
import { usePaginatedHistory } from 'coco-cashu-react';
import { adaptCocoHistoryToTransaction } from 'helper/coco/typeAdapters';
import { EcashSendConfirmation } from './ecashSendConfirmation';
import { EcashReceiveConfirmation } from './ecashReceiveConfirmation';
import { LightningReceiveConfirmation } from './lightningReceiveConfirmation';
import { LightningSendConfirmation } from './lightningSendConfirmation';
import { TransferRow } from 'components/blocks/TransferRow';
import { ScrollView } from 'react-native';
import { Section } from 'components/ui/Section';
// useTypedNavigation is already imported; removing duplicate

function VirtualBatchTransaction({ batchId }: { batchId: string }) {
  const { history } = usePaginatedHistory();

  // Filter Coco history entries for this batch and adapt them
  const batchTxs = (history || [])
    .filter((t) => t.type === 'mint') // Coco uses 'mint' for Lightning-to-ecash
    .map(adaptCocoHistoryToTransaction)
    .filter((t) => t.batchId === batchId);

  const receivesByRequest = new Map<string, any>();
  const sendsByRequest = new Map<string, any>();

  for (const tx of batchTxs) {
    // Use adapted transaction structure
    if (tx.type === 'mint' && tx.request) {
      receivesByRequest.set(tx.request, tx);
    } else if (tx.type === 'send' && tx.request) {
      sendsByRequest.set(tx.request, tx);
    }
  }

  const pairs = Array.from(receivesByRequest.entries())
    .map(([request, receiveTx]) => {
      const sendTx = sendsByRequest.get(request);
      if (!sendTx) return null;
      // Use adapted transaction state
      const status: 'success' | 'pending' | 'error' | undefined =
        receiveTx.state === 'PAID' ? 'success' : receiveTx.state === 'UNPAID' ? 'pending' : 'error';

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
                      router.push({
                        pathname: '/transaction',
                        params: {
                          id: p.request,
                          transactionType: 'send',
                        },
                      }),
                  }}
                  rightCta={{
                    label: 'View Invoice',
                    onPress: () =>
                      router.push({
                        pathname: '/transaction',
                        params: {
                          id: p.request,
                          transactionType: 'receive',
                        },
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
  const { id, transactionType } = useLocalSearchParams<{
    id: string;
    transactionType: string;
  }>();
  const { history } = usePaginatedHistory();

  if (typeof id === 'string' && id.startsWith('batch:')) {
    const batchId = id.replace('batch:', '');
    return <VirtualBatchTransaction batchId={batchId} />;
  }

  // Find and adapt the transaction
  const historyEntry = history.find(
    (t) =>
      t.id === id ||
      String(t.id) === String(id) ||
      ('request' in t && t.request === id && t.type === transactionType) ||
      ('token' in t && typeof t.token === 'string' && t.token === id && t.type === transactionType)
  );

  const transaction = historyEntry ? adaptCocoHistoryToTransaction(historyEntry) : null;

  if (!transaction) {
    return (
      <Modal showClose>
        <View>
          <Text>Transaction not found</Text>
        </View>
      </Modal>
    );
  }

  // Use adapted transaction structure
  if (transaction.type === 'send' && transaction.token) {
    return (
      <EcashSendConfirmation
        unit={transaction.unit}
        amount={transaction.amount}
        token={transaction.token}
      />
    );
  }

  if (transaction.type === 'mint' && transaction.token) {
    return <EcashReceiveConfirmation transaction={transaction} token={transaction.token} />;
  }

  if (transaction.type === 'mint' && transaction.paymentRequest) {
    return (
      <LightningReceiveConfirmation
        request={transaction.paymentRequest}
        unit={transaction.unit}
        amount={transaction.amount}
        autoGoBackOnPaid={false}
      />
    );
  }

  if (transaction.type === 'send' && transaction.request) {
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
