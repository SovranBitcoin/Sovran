import React, { useEffect, useState } from 'react';
import { Share } from 'react-native';
import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import * as Clipboard from 'expo-clipboard';
import Modal from 'components/blocks/Modal';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { popup } from '@/helper/popup';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { useManager, usePaginatedHistory } from 'coco-cashu-react';
import { Section } from 'components/ui/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/blocks/Transaction/TransactionHeader';
import { truncateMiddle } from 'helper/strings';
import { Card } from 'components/ui/Card';
import { useLocalSearchParams } from 'expo-router';
import type { ButtonHandlerButton } from 'components/ui/ButtonHandler';
import { TransactionMintRefresh } from 'components/blocks/Transaction/TransactionMintRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { TransactionTimeline } from 'components/blocks/Transaction/TransactionTimeline';
import type { MintHistoryEntry, HistoryEntry } from 'coco-cashu-core';

export function LightningReceiveConfirmation({
  mintHistoryEntry,
  extraButtons = [],
}: {
  mintHistoryEntry: MintHistoryEntry;
  autoGoBackOnPaid?: boolean;
  extraButtons?: ButtonHandlerButton[];
}) {
  const manager = useManager();
  const [uri, setUri] = useState<string | null>(null);
  const [mintInfo, setMintInfo] = useState<any>(null);

  const { history } = usePaginatedHistory();

  // Find the current transaction using Coco's history system
  const currentTransaction = history.find(
    (historyEntry: HistoryEntry) =>
      historyEntry.type === 'mint' &&
      historyEntry.paymentRequest === mintHistoryEntry.paymentRequest
  );

  // Load mint info when transaction is found
  useEffect(() => {
    if (currentTransaction?.mintUrl) {
      manager.mint
        .getMintInfo(currentTransaction.mintUrl)
        .then(setMintInfo)
        .catch(() => setMintInfo(null));
    }
  }, [currentTransaction?.mintUrl, manager]);

  const handleCopy = async (close: (event: any) => void) => {
    await Clipboard.setStringAsync(mintHistoryEntry.paymentRequest);
    popup({ message: 'lightning_address_copied', type: 'success', onClose: () => close({}) });
  };

  const handleShare = async (close: (event: any) => void) => {
    if (uri) {
      await Share.share({ url: uri, message: mintHistoryEntry.paymentRequest });
    }
    close({});
  };

  // Show loading state if transaction is not found
  if (!currentTransaction) {
    return (
      <Modal showClose title="Loading...">
        <View style={{ padding: 20, alignItems: 'center' }}>
          <Text>Loading transaction...</Text>
        </View>
      </Modal>
    );
  }

  const isBitcoin = mintHistoryEntry.unit === 'sat';
  const isPaid =
    (currentTransaction as any)?.state === 'ISSUED' ||
    (currentTransaction as any)?.state === 'PAID';

  return (
    <Modal
      showClose
      title={`Receive ${isBitcoin ? 'Bitcoin' : mintHistoryEntry.unit.toUpperCase()}`}
      buttons={
        <HStack justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                text: 'Copy',
                icon: 'lets-icons:copy',
                variant: 'primary',
                onPress: handleCopy,
                condition: !isPaid,
              },
              {
                text: 'Share',
                icon: 'ri:share-fill',
                variant: 'secondary',
                onPress: handleShare,
                condition: !isPaid,
              },
              ...extraButtons.map((button) => ({ ...button, condition: !isPaid })),
            ]}
          />
        </HStack>
      }>
      <VStack gap={12}>
        <TransactionHeader historyEntry={currentTransaction} />
        {!isPaid && (
          <PaymentInfo
            showSection={false}
            setUri={setUri}
            data={[{ name: 'Lightning', value: mintHistoryEntry.paymentRequest }]}
            unit={mintHistoryEntry.unit}
            popupMessage={[{ name: 'lightning_address_copied' }]}
          />
        )}

        {currentTransaction.metadata?.memo && (
          <>
            <Card message={currentTransaction.metadata.memo} variant="info" />
          </>
        )}

        <TransactionMintRefresh
          mintInfo={mintInfo}
          historyEntry={currentTransaction}
          handleCheckStatus={async () => {}}
        />

        <TransactionTimeline historyEntry={currentTransaction} />

        <Section
          special={false}
          items={[
            {
              title: 'Request',
              value: truncateMiddle(mintHistoryEntry.paymentRequest, 10),
            },
            {
              title: 'Type',
              value: 'Lightning • Receive',
            },
            {
              title: 'Status',
              value: (
                <HStack align="center">
                  <Text
                    className="text-primary-0"
                    style={{ fontSize: 16, fontFamily: 'OverpassBold' }}>
                    {isPaid ? 'Completed' : 'Pending'}
                  </Text>
                </HStack>
              ),
            },
            {
              title: 'Amount',
              value: `${currentTransaction.amount} ${mintHistoryEntry.unit.toUpperCase()}`,
            },
          ]}
        />

        <TransactionDebugCode historyEntry={currentTransaction} />
      </VStack>
    </Modal>
  );
}

function ModalScreen() {
  const { mintHistoryEntry: mintHistoryEntryString } = useLocalSearchParams<{
    mintHistoryEntry: string;
  }>();

  const mintHistoryEntry = JSON.parse(mintHistoryEntryString) as MintHistoryEntry;

  return <LightningReceiveConfirmation mintHistoryEntry={mintHistoryEntry} />;
}

export default withSheetProvider(ModalScreen);
