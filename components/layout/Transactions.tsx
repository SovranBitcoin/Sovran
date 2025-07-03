import React from 'react';
import { SectionList, TouchableOpacity, Dimensions } from 'react-native';
import { useSelector } from 'react-redux';
import { useNavigation } from 'expo-router';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Transaction } from 'components/layout/Transaction';
import { Text } from 'components/common/Text';
import Icon from 'assets/icons';
import { View } from 'components/common/View';
import { TransactionData } from 'helper/redux/cashu';

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
    account,
    showMore,
    pendingSections,
    confirmedSections,
    allSections,
    filteredCount,
    morePendingCount,
  }: Props) => {
    const theme = useSelector(memoizedGetTheme);
    const navigation = useNavigation();

    if (filteredCount === 0) {
      return (
        <View className="flex items-center">
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

    if (showMore) {
      const renderStatus = (label: string, sections: Section[]) => {
        if (sections.length === 0) return null;
        return (
          <View>
            <View className="flex-row items-start">
              <Text heavy size={16} color={theme.greys[100]} className="mt-2">
                {label}
              </Text>
            </View>
            {sections.map((section) => (
              <View key={section.title}>
                <Text size={14} heavy color={theme.greys[100]} className="mb-1">
                  {section.title}
                </Text>
                <View
                  style={{ backgroundColor: theme.greys[900] }}
                  className="rounded-lg"
                  blur>
                  {section.data.map((tx) => (
                    <Transaction
                      key={tx.request || tx.token || tx.txid || tx.id || Math.random().toString()}
                      tx={tx}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        );
      };

      return (
        <View className="w-full pb-24">
          {renderStatus('Pending transactions', pendingSections)}
          {morePendingCount > 0 && (
            <TouchableOpacity onPress={() => navigation.navigate('transactions', { account, tab: 'Pending' })}>
              <View
                blur
                className="mt-4 flex items-center rounded-full border p-3"
                style={{ backgroundColor: theme.greys[800], borderColor: theme.greys[700] }}>
                <Text size={14} bold>
                  {morePendingCount} more pending transaction{morePendingCount > 1 ? 's' : ''}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          {renderStatus('Confirmed transactions', confirmedSections)}
          <TouchableOpacity
            onPress={() => navigation.navigate('transactions', { account })}>
            <View
              blur
              className="mt-4 flex items-center rounded-full border p-3"
              style={{ backgroundColor: theme.greys[800], borderColor: theme.greys[700] }}>
              <Text size={14} bold>
                View all ({filteredCount})
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    const HEADER_HEIGHT = 30;
    const ITEM_HEIGHT = 69;
    const getItemLayout = (data: Section[], index: number) => {
      let offset = 0;
      let itemIndex = index;

      for (let section of data) {
        offset += HEADER_HEIGHT;
        if (itemIndex < section.data.length) {
          offset += ITEM_HEIGHT * itemIndex;
          return { length: ITEM_HEIGHT, offset, index };
        } else {
          itemIndex -= section.data.length;
          offset += ITEM_HEIGHT * section.data.length;
        }
      }
      return { length: ITEM_HEIGHT, offset: offset, index };
    };

    return (
      <SectionList
        style={{ minHeight: Dimensions.get('screen').height }}
        sections={allSections}
        keyExtractor={(item) => item.request || item.token || Math.random().toString()}
        renderItem={({ item, section, index }) => (
          <View
            style={{
              backgroundColor: theme.greys[800],
              borderRadius: 8,
              borderTopLeftRadius: index === 0 ? 8 : 0,
              borderTopRightRadius: index === 0 ? 8 : 0,
              borderBottomLeftRadius: index === section.data.length - 1 ? 8 : 0,
              borderBottomRightRadius: index === section.data.length - 1 ? 8 : 0,
              height: ITEM_HEIGHT,
            }}>
            <Transaction key={item.request || item.token} tx={item} />
          </View>
        )}
        renderSectionHeader={({ section: { title } }) => (
          <Text
            size={14}
            heavy
            color={theme.greys[500]}
            style={{ height: HEADER_HEIGHT }}
            className="mb-1 mt-2">
            {title}
          </Text>
        )}
        contentContainerStyle={{ width: '100%', paddingBottom: 1000 }}
        maxToRenderPerBatch={3}
        windowSize={5}
        getItemLayout={getItemLayout}
        initialNumToRender={10}
      />
    );
  }
);

Transactions.displayName = 'Transactions';
