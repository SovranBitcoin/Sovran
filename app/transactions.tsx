import { View, HStack, VStack } from 'components/common/View';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedRoute } from 'helper/navigation';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import React, { useState } from 'react';
import { Transactions } from 'components/layout/Transactions';
import { useCashu } from 'helper/redux/cashu';
import { useTransactionsData } from 'hooks/useTransactionsData';
import Container from 'components/layout/Container';
import CurrencySelector from 'components/layout/CurrencySelector';
import Icon from 'assets/icons';
import { Tabs } from 'components/common/Tabs';
import { withSheetProvider } from 'hocs/withSheetProvider';

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const { account, tab: tab_ } = useTypedRoute<'transactions'>();
  const [selectedCurrency, setSelectedCurrency] = useState(account.unit);
  const [filter, setFilter] = useState<'all' | 'incoming' | 'outgoing'>('all');
  const [type, setType] = useState<string>('all');
  const [at, setAt] = useState<string>('all');
  const [tab, setTab] = useState(tab_ || 'All');

  const handleCurrencyChange = (currency: string) => {
    setSelectedCurrency(currency.toLowerCase());
  };

  const toggleFilter = (newFilter: 'incoming' | 'outgoing') => {
    setFilter((prevFilter) => (prevFilter === newFilter ? 'all' : newFilter));
  };

  const toggleType = (newType: 'lightning' | 'ecash') => {
    setType((prevType) => (prevType === newType ? 'all' : newType));
    setAt('all');
  };

  const toggleAt = (newAt: 'at' | 'all') => {
    setAt((prevAt) => (prevAt === newAt ? 'all' : newAt));
    setType('all');
  };

  const { transactions } = useCashu();
  const txData = useTransactionsData({
    transactions,
    account: { ...account, unit: selectedCurrency },
    filter,
    type,
    at,
    tab,
    showMore: false,
  });

  const totalCounts = useTransactionsData({
    transactions,
    account: { ...account, unit: selectedCurrency },
    filter: 'all',
    type: 'all',
    at: 'all',
    tab: 'All',
    showMore: false,
  }).counts;

  const listKey = `${filter}-${type}-${at}-${tab}-${selectedCurrency}`;

  return (
    <Container>
      <Transactions
        listKey={listKey}
        header={
          <>
            <Tabs
              tabs={['All', 'Confirmed', 'Pending']}
              selectedTab={tab}
              handleTabPress={(tab) => setTab(tab)}
              amounts={[
                String(totalCounts.all),
                String(totalCounts.confirmed),
                String(totalCounts.pending),
              ]}
            />

            <View
              style={{
                height: 4,
              }}></View>

            <CurrencySelector
              selectedCurrency={selectedCurrency.toUpperCase()}
              onCurrencyChange={handleCurrencyChange}
            />
            <HStack justify="space-between" align="center" className="my-2 w-full">
              <TouchableOpacity
                onPress={() => toggleAt('at')}
                className="mr-2 flex-1"
                style={{
                  backgroundColor: at === 'at' ? greys(theme)[700] : greys(theme)[950],
                  padding: 8,
                  borderRadius: 8,
                  borderWidth: 0.5,
                  borderColor: greys(theme)[700],
                }}>
                <HStack align="center" justify="center">
                  <Icon
                    name="mdi:at" // Assuming this is the lightning icon
                    size={24}
                    color={at === 'at' ? greys(theme)[0] : greys(theme)[500]}
                  />
                </HStack>
              </TouchableOpacity>
              <View
                className="mr-2 h-4 w-px"
                style={{
                  backgroundColor: greys(theme)[700],
                }}
              />
              <TouchableOpacity
                onPress={() => toggleType('lightning')}
                className="mr-2 flex-1"
                style={{
                  backgroundColor: type === 'lightning' ? greys(theme)[700] : greys(theme)[950],
                  padding: 8,
                  borderRadius: 8,
                  borderWidth: 0.5,
                  borderColor: greys(theme)[700],
                }}>
                <HStack align="center" justify="center">
                  <Icon
                    name="mingcute:lightning-fill" // Assuming this is the lightning icon
                    size={24}
                    color={type === 'lightning' ? greys(theme)[0] : greys(theme)[500]}
                  />
                </HStack>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => toggleType('ecash')}
                className="mr-2 flex-1"
                style={{
                  backgroundColor: type === 'ecash' ? greys(theme)[700] : greys(theme)[950],
                  padding: 8,
                  borderRadius: 8,
                  borderWidth: 0.5,
                  borderColor: greys(theme)[700],
                }}>
                <HStack align="center" justify="center">
                  <Icon
                    name="majesticons:coins" // Assuming this is the ecash icon or a coins icon
                    size={24}
                    color={type === 'ecash' ? greys(theme)[0] : greys(theme)[500]}
                  />
                </HStack>
              </TouchableOpacity>
              <View
                className="mr-2 h-4 w-px"
                style={{
                  backgroundColor: greys(theme)[700],
                }}
              />
              <TouchableOpacity
                onPress={() => toggleFilter('incoming')}
                className="mr-2 flex-1"
                style={{
                  backgroundColor: filter === 'incoming' ? greys(theme)[700] : greys(theme)[950],
                  padding: 8,
                  borderRadius: 8,
                  borderWidth: 0.5,
                  borderColor: greys(theme)[700],
                }}>
                <HStack align="center" justify="center">
                  <Icon
                    name="fluent:arrow-download-16-filled"
                    size={24}
                    color={filter === 'incoming' ? greys(theme)[0] : greys(theme)[500]}
                  />
                </HStack>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => toggleFilter('outgoing')}
                className="flex-1"
                style={{
                  backgroundColor: filter === 'outgoing' ? greys(theme)[700] : greys(theme)[950],
                  padding: 8,
                  borderRadius: 8,
                  borderWidth: 0.5,
                  borderColor: greys(theme)[700],
                }}>
                <HStack align="center" justify="center">
                  <Icon
                    name="fluent:arrow-upload-16-filled"
                    size={24}
                    color={filter === 'outgoing' ? greys(theme)[0] : greys(theme)[500]}
                  />
                </HStack>
              </TouchableOpacity>
            </HStack>
          </>
        }
        account={{
          ...account,
          unit: selectedCurrency,
        }}
        showMore={false}
        pendingSections={txData.pendingSections}
        confirmedSections={txData.confirmedSections}
        allSections={txData.allSections}
        filteredCount={txData.filteredTransactions.length}
        morePendingCount={txData.morePendingCount}
      />
    </Container>
  );
}

export default withSheetProvider(ModalScreen);
