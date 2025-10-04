import React, { useEffect, useState } from 'react';
import { Share } from 'react-native';
import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import * as Clipboard from 'expo-clipboard';
import Modal from 'components/blocks/Modal';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { useSelector } from 'react-redux';
import { showSuccess } from 'helper/popup/popups';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { useManager, usePaginatedHistory } from 'coco-cashu-react';
import { Section } from 'components/ui/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { TransactionHeader } from 'components/blocks/Transaction/TransactionHeader';
import { memoizedGetTheme } from 'helper/redux/settings';
import { truncateMiddle } from 'helper/strings';
import { Card } from 'components/ui/Card';
import { useLocalSearchParams } from 'expo-router';

import type { ButtonHandlerButton } from 'components/ui/ButtonHandler';
import { greens, greys } from 'helper/colors';
import { convertTime } from 'helper/time';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { TransactionMintRefresh } from 'components/blocks/Transaction/TransactionMintRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import type { HistoryEntry, MintHistoryEntry, MeltHistoryEntry } from 'coco-cashu-core';
import { mintHistoryEntryExpired } from 'helper/utils';

interface MintQuoteTimelineProps {
  historyEntry: HistoryEntry;
}

export function MintQuoteTimeline({ historyEntry }: MintQuoteTimelineProps) {
  const theme = useSelector(memoizedGetTheme);
  const [collapsed, setCollapsed] = useState(false);

  const isMintTransaction = historyEntry.type === 'mint';

  const getTimeline = () => {
    if (isMintTransaction) {
      const mintTx = historyEntry as MintHistoryEntry;

      // Check if the transaction is expired
      const isExpired = mintTx.state === 'UNPAID' && mintHistoryEntryExpired(mintTx);

      if (isExpired) {
        // Show EXPIRED state instead of normal flow
        const states = ['CREATED', 'UNPAID', 'EXPIRED'];
        return states.map((state, i) => ({
          state,
          complete: i <= 2, // All states up to EXPIRED are complete
          isCurrent: i === 2, // EXPIRED is current
          addedAt: i === 0 ? mintTx.createdAt : undefined,
        }));
      }

      const states = ['CREATED', 'UNPAID', 'ISSUED', 'PAID'];

      // Find current state index
      const currentStateIndex = states.indexOf(mintTx.state);
      const maxIndex = Math.max(0, currentStateIndex);

      return states.map((state, i) => ({
        state,
        complete: i <= maxIndex,
        isCurrent: i === maxIndex,
        addedAt: i === 0 ? mintTx.createdAt : undefined,
      }));
    } else {
      const meltTx = historyEntry as MeltHistoryEntry;
      const states = ['CREATED', 'UNSPENT', 'PENDING', 'SPENT'];

      // Find current state index
      const currentStateIndex = states.indexOf(meltTx.state);
      const maxIndex = Math.max(0, currentStateIndex);

      return states.map((state, i) => ({
        state,
        complete: i <= maxIndex,
        isCurrent: i === maxIndex,
        addedAt: i === 0 ? meltTx.createdAt : undefined,
      }));
    }
  };

  const states = getTimeline();

  const isExpired = isMintTransaction && mintHistoryEntryExpired(historyEntry as MintHistoryEntry);

  const hasIntermediarySteps = isMintTransaction
    ? (historyEntry as MintHistoryEntry).state === 'UNPAID' && !isExpired
    : (historyEntry as MeltHistoryEntry).state === ('UNSPENT' as any) ||
      (historyEntry as MeltHistoryEntry).state === ('PENDING' as any);

  const shouldCollapse = collapsed && !hasIntermediarySteps;

  const displayStates = shouldCollapse
    ? states.filter((_, i) => i === 0 || i === states.length - 1)
    : states;

  const barWidth = 4.5;
  const barHeight = 48;
  const barMarginVertical = 4;
  const dotSize = barWidth;
  const dotSpacing = 8;

  const getBarColor = (item: any) => {
    if (item.state === 'CANCELLED' || item.state === 'EXPIRED') {
      return '#ef4444';
    }

    return item.complete ? greens[300] : greys(theme)[200];
  };

  const getStateLabel = (s: string) => {
    switch (s) {
      case 'UNPAID':
        return 'PENDING';
      default:
        return s;
    }
  };

  return (
    <View
      blur
      style={{
        backgroundColor: greys(theme)[800],
        padding: 16,
        marginHorizontal: 16,
        borderRadius: 12,
      }}>
      <Text
        size={14}
        bold
        style={{
          color: greys(theme)[200],
          marginBottom: 8,
          textTransform: 'uppercase',
        }}>
        {isExpired
          ? 'EXPIRED'
          : getStateLabel(
              isMintTransaction
                ? (historyEntry as MintHistoryEntry).state
                : (historyEntry as MeltHistoryEntry).state
            )}
      </Text>
      <View>
        {displayStates.map((item, index) => (
          <React.Fragment key={`${item.state}-${index}`}>
            <HStack
              style={{
                marginVertical: 0,
              }}
              align="center">
              <TouchableOpacity
                onPress={() => {
                  // Handle navigation if needed
                }}
                style={{
                  flex: 1,
                  marginVertical: barMarginVertical,
                  overflow: 'hidden',
                }}>
                <HStack align="center">
                  <View
                    style={{
                      width: barWidth,
                      height: barHeight,
                      backgroundColor: getBarColor(item),
                      borderRadius: barWidth / 2,
                      // marginVertical: barMarginVertical,
                      opacity: item.isCurrent ? 1 : 0.5,
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      size={16}
                      bold
                      style={{
                        color: greys(theme)[0],
                        marginStart: 12,
                      }}>
                      {getStateLabel(item.state)}
                    </Text>
                    {item.addedAt ? (
                      <Text
                        size={12}
                        bold
                        style={{
                          color: greys(theme)[300],
                          marginStart: 12,
                        }}>
                        {convertTime(new Date(item.addedAt))}
                      </Text>
                    ) : null}
                  </View>
                </HStack>
              </TouchableOpacity>
            </HStack>

            {shouldCollapse && index === 0 && states.length > 2 && (
              <VStack
                style={{
                  alignItems: 'flex-start',
                  opacity: 0.5,
                }}>
                {[...Array(3)].map((_, i) => (
                  <View
                    key={i}
                    style={{
                      width: dotSize,
                      height: dotSize,
                      backgroundColor: states[1].complete ? greens[300] : greys(theme)[200],
                      borderRadius: dotSize / 3,
                      marginVertical: dotSpacing / 3,
                    }}
                  />
                ))}
              </VStack>
            )}
          </React.Fragment>
        ))}
      </View>

      {/* Collapse toggle */}
      {!hasIntermediarySteps && (
        <TouchableOpacity onPress={() => setCollapsed(!collapsed)}>
          <Text
            size={14}
            bold
            style={{
              color: greys(theme)[200],
              marginBottom: 8,
              textTransform: 'uppercase',
              textAlign: 'right',
            }}>
            {collapsed ? 'EXPAND' : 'COLLAPSE'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function LightningReceiveConfirmation({
  request,
  unit,
  extraButtons = [],
}: {
  request: string;
  paymentRequest?: string;
  unit: string;
  autoGoBackOnPaid?: boolean;
  extraButtons?: ButtonHandlerButton[];
}) {
  const manager = useManager();
  const theme = useSelector(memoizedGetTheme);
  const [uri, setUri] = useState<string | null>(null);
  const [mintInfo, setMintInfo] = useState<any>(null);

  const { history } = usePaginatedHistory();

  // Find the current transaction using Coco's history system
  const currentTransaction = history.find(
    (tx: HistoryEntry) => tx.type === 'mint' && (tx as MintHistoryEntry).paymentRequest === request
  ) as MintHistoryEntry | undefined;

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
    await Clipboard.setStringAsync(request);
    showSuccess('lightning_address_copied', {}, {}, () => close({}));
  };

  const handleShare = async (close: (event: any) => void) => {
    if (uri) {
      await Share.share({ url: uri, message: request });
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

  const isBitcoin = unit === 'sat';
  const isPaid = currentTransaction?.state === 'ISSUED' || currentTransaction?.state === 'PAID';

  return (
    <Modal
      showClose
      title={`Receive ${isBitcoin ? 'Bitcoin' : unit.toUpperCase()}`}
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
      <TransactionHeader historyEntry={currentTransaction} />
      <VStack gap={12}>
        {!isPaid && (
          <PaymentInfo
            showSection={false}
            setUri={setUri}
            data={[{ name: 'Lightning', value: request }]}
            unit={unit}
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

        <MintQuoteTimeline historyEntry={currentTransaction} />

        <Section
          special={false}
          items={[
            {
              title: 'Request',
              value: truncateMiddle(request, 10),
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
                    style={{ color: greys(theme)[0], fontSize: 16, fontFamily: 'OverpassBold' }}>
                    {isPaid ? 'Completed' : 'Pending'}
                  </Text>
                </HStack>
              ),
            },
            {
              title: 'Amount',
              value: `${currentTransaction.amount} ${unit.toUpperCase()}`,
            },
          ]}
        />

        <TransactionDebugCode historyEntry={currentTransaction} />
      </VStack>
    </Modal>
  );
}

function ModalScreen() {
  const { request, unit } = useLocalSearchParams<{
    request: string;
    unit: string;
  }>();

  return <LightningReceiveConfirmation request={request} unit={unit} />;
}

export default withSheetProvider(ModalScreen);
