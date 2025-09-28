import React from 'react';
import { Dimensions, TouchableOpacity } from 'react-native';
import { LegendList } from '@legendapp/list';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Transaction } from 'components/blocks/Transaction';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { View, VStack, Spacer } from 'components/ui/View';
import { TransactionData } from 'helper/redux/cashu';
import { useTypedNavigation } from 'helper/navigation';

interface Account {
  unit: string;
  type?: string;
}

interface Section {
  title: string;
  data: TransactionData[];
  index?: string;
}

interface Props {
  header?: React.ReactElement | (() => React.ReactElement) | null;
  listKey?: string;
  account: Account;
  showMore: boolean;
  pendingSections: Section[];
  confirmedSections: Section[];
  allSections: Section[];
  filteredCount: number;
  morePendingCount: number;
}

export const Transactions = React.memo(
  ({
    header,
    listKey,
    account,
    showMore,
    pendingSections,
    confirmedSections,
    allSections,
    filteredCount,
    morePendingCount,
  }: Props) => {
    const theme = useSelector(memoizedGetTheme);
    const navigation = useTypedNavigation<'transactions'>();

    const HEADER_HEIGHT = 30;
    const ITEM_HEIGHT = 69;

    const flattenedData = React.useMemo(() => {
      const isReallocationTx = (tx: TransactionData) => {
        console.log('tx', tx);
        const text =
          `${(tx as any)?.memo || ''} ${(tx as any)?.message || ''} ${(tx as any)?.note || ''}`.toLowerCase();
        return text.includes('reallocation') || Boolean(tx.batchId);
      };

      // Build virtual batch transactions per section
      const enhanceSection = (section: Section) => {
        const visibleTx = section.data.filter((tx) => !isReallocationTx(tx));
        const batchGroups = section.data
          .filter((tx) => isReallocationTx(tx) && tx.batchId)
          .reduce((acc: Record<string, TransactionData[]>, tx) => {
            const key = tx.batchId as string;
            acc[key] = acc[key] || [];
            acc[key].push(tx);
            return acc;
          }, {});

        const virtualItems = Object.keys(batchGroups).map((batchId) => ({
          type: 'virtual' as const,
          txs: batchGroups[batchId],
          batchId,
        }));

        return [
          { type: 'header' as const, title: section.title },
          ...virtualItems,
          ...visibleTx.map((tx) => ({ type: 'item' as const, tx })),
        ];
      };

      return allSections.flatMap(enhanceSection);
    }, [allSections]);

    if (showMore) {
      if (filteredCount === 0) {
        return (
          <View
            className="flex items-center"
            style={{
              minHeight: Dimensions.get('screen').height / 2,
            }}>
            <Icon name="fluent:clock-12-filled" color={theme.greys[500]} />
            <Text heavy size={16} style={{ color: theme.greys[500] }}>
              No Transactions
            </Text>
            <Text color={theme.greys[500]} heavy size={16}>
              Your transactions will show up here
            </Text>
          </View>
        );
      }

      const renderStatus = (label: string, sections: Section[]) => {
        if (sections.length === 0) return null;
        return (
          <View>
            <VStack spacing={8}>
              <Spacer size={8} />
              <Text heavy size={16} color={theme.greys[100]}>
                {label}
              </Text>
              {sections.map((section) => (
                <View key={section.title}>
                  <VStack spacing={4}>
                    <Text size={14} heavy color={theme.greys[100]}>
                      {section.title}
                    </Text>
                    <View style={{ backgroundColor: theme.greys[900] }} className="rounded-lg" blur>
                      {(() => {
                        const textOf = (tx: TransactionData) =>
                          `${(tx as any)?.memo ?? ''} ${(tx as any)?.message ?? ''} ${(tx as any)?.note ?? ''}`.toLowerCase();
                        const isReallocationTx = (tx: TransactionData) =>
                          textOf(tx).includes('reallocation') || Boolean(tx.batchId);

                        const visibleTx = section.data.filter((tx) => !isReallocationTx(tx));
                        const batchIds = Array.from(
                          new Set(
                            section.data
                              .filter((tx) => isReallocationTx(tx) && tx.batchId)
                              .map((tx) => tx.batchId as string)
                          )
                        );

                        return (
                          <>
                            {batchIds.map((batchId) => (
                              <Transaction
                                key={`batch-${batchId}`}
                                txs={section.data.filter((t) => t.batchId === batchId)}
                              />
                            ))}
                            {visibleTx.map((tx) => (
                              <Transaction
                                key={
                                  tx.request ||
                                  tx.token ||
                                  tx.txid ||
                                  tx.id ||
                                  Math.random().toString()
                                }
                                tx={tx}
                              />
                            ))}
                          </>
                        );
                      })()}
                      {morePendingCount > 0 && label === 'Pending transactions' && (
                        <TouchableOpacity
                          onPress={() =>
                            navigation.navigate('transactions', { account, tab: 'Pending' })
                          }>
                          <View
                            blur
                            className="flex items-center rounded-lg border p-3"
                            style={{
                              backgroundColor: theme.greys[800],
                              borderColor: theme.greys[700],
                            }}>
                            <Text size={14} bold>
                              View pending transaction{morePendingCount > 1 ? 's' : ''} {'('}
                              {morePendingCount}
                              {')'}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      )}
                      {label === 'Confirmed transactions' && (
                        <TouchableOpacity
                          onPress={() =>
                            navigation.navigate('transactions', { account, tab: 'Confirmed' })
                          }>
                          <View
                            blur
                            className="flex items-center rounded-lg border p-3"
                            style={{
                              backgroundColor: theme.greys[800],
                              borderColor: theme.greys[700],
                            }}>
                            <Text size={14} bold>
                              View all ({filteredCount})
                            </Text>
                          </View>
                        </TouchableOpacity>
                      )}
                    </View>
                  </VStack>
                </View>
              ))}
            </VStack>
          </View>
        );
      };

      return (
        <View className="w-full pb-24">
          {renderStatus('Pending transactions', pendingSections)}

          {renderStatus('Confirmed transactions', confirmedSections)}
        </View>
      );
    }

    return (
      <LegendList
        waitForInitialLayout={false}
        key={listKey}
        style={{ height: Dimensions.get('screen').height, overflow: 'hidden' }}
        data={flattenedData}
        estimatedItemSize={ITEM_HEIGHT}
        scrollEnabled
        maintainVisibleContentPosition
        ListHeaderComponent={header}
        renderItem={({ item, index }) => {
          if (item.type === 'header') {
            return (
              <Text size={14} heavy color={theme.greys[500]} style={{ height: HEADER_HEIGHT }}>
                {item.title}
              </Text>
            );
          }
          if (item.type === 'virtual') {
            return <Transaction txs={item.txs} />;
          }

          const prev = flattenedData[index - 1];
          const next = flattenedData[index + 1];
          const isFirst = !prev || prev.type === 'header';
          const isLast = !next || next.type === 'header';

          return (
            <View
              blur
              style={{
                backgroundColor: theme.greys[800],
                borderRadius: 8,
                borderTopLeftRadius: isFirst ? 8 : 0,
                borderTopRightRadius: isFirst ? 8 : 0,
                borderBottomLeftRadius: isLast ? 8 : 0,
                borderBottomRightRadius: isLast ? 8 : 0,
                height: ITEM_HEIGHT,
              }}>
              <Transaction key={item.tx.request || item.tx.token} tx={item.tx} />
            </View>
          );
        }}
        contentContainerStyle={{ width: '100%', paddingBottom: 250 }}
      />
    );
  }
);

Transactions.displayName = 'Transactions';
