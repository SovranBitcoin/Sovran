import { View } from 'components/common/View';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedRoute } from 'helper/navigation';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import React, { useState } from 'react';
import { Transactions } from 'components/layout/Transactions';
import { useCashu } from 'helper/redux/cashu';
import { useTransactionsData } from 'helper/hooks/useTransactionsData';
import Container from 'components/layout/Container';
import CurrencySelector from 'components/layout/CurrencySelector';
import Icon from 'assets/icons';
import { Tabs } from 'components/common/Tabs';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const { account, tab: tab_ } = useTypedRoute<'transactions'>() || {
    account: { unit: '' },
  };
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

  const toggleType = (newType) => {
    setType((prevType) => (prevType === newType ? 'all' : newType));
    setAt('all');
  };

  const toggleAt = (newAt) => {
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
              handleTabPress={setTab}
              amounts={[totalCounts.all, totalCounts.confirmed, totalCounts.pending]}
            />

            <View
              style={{
                height: 4,
              }}></View>

            <CurrencySelector
              selectedCurrency={selectedCurrency.toUpperCase()}
              onCurrencyChange={handleCurrencyChange}
            />
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between', // Changed to space-between to fill the width
                alignItems: 'center',
                marginVertical: 8,
                width: '100%', // Set width to 100% to fill the page
              }}>
              <TouchableOpacity
                onPress={() => toggleAt('at')}
                style={{
                  backgroundColor: at === 'at' ? greys(theme)[700] : greys(theme)[950],
                  padding: 8,
                  borderRadius: 8,
                  borderWidth: 0.5,
                  borderColor: greys(theme)[700],
                  flex: 1, // Allow the button to grow
                  marginRight: 8, // Add margin to separate buttons
                  alignItems: 'center', // Center the icon inside the container
                }}>
                <Icon
                  name="mdi:at" // Assuming this is the lightning icon
                  size={24}
                  color={at === 'at' ? greys(theme)[0] : greys(theme)[500]}
                />
              </TouchableOpacity>
              <View
                style={{
                  width: 1,
                  marginRight: 8,
                  height: 16,
                  backgroundColor: greys(theme)[700],
                }}
              />
              <TouchableOpacity
                onPress={() => toggleType('lightning')}
                style={{
                  backgroundColor: type === 'lightning' ? greys(theme)[700] : greys(theme)[950],
                  padding: 8,
                  borderRadius: 8,
                  borderWidth: 0.5,
                  borderColor: greys(theme)[700],
                  flex: 1, // Allow the button to grow
                  marginRight: 8, // Add margin to separate buttons
                  alignItems: 'center', // Center the icon inside the container
                }}>
                <Icon
                  name="mingcute:lightning-fill" // Assuming this is the lightning icon
                  size={24}
                  color={type === 'lightning' ? greys(theme)[0] : greys(theme)[500]}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => toggleType('ecash')}
                style={{
                  backgroundColor: type === 'ecash' ? greys(theme)[700] : greys(theme)[950],
                  padding: 8,
                  borderRadius: 8,
                  borderWidth: 0.5,
                  borderColor: greys(theme)[700],
                  flex: 1, // Allow the button to grow
                  marginRight: 8, // Add margin to separate buttons
                  alignItems: 'center', // Center the icon inside the container
                }}>
                <Icon
                  name="majesticons:coins" // Assuming this is the ecash icon or a coins icon
                  size={24}
                  color={type === 'ecash' ? greys(theme)[0] : greys(theme)[500]}
                />
              </TouchableOpacity>
              <View
                style={{
                  width: 1,
                  marginRight: 8,
                  height: 16,
                  backgroundColor: greys(theme)[700],
                }}
              />
              <TouchableOpacity
                onPress={() => toggleFilter('incoming')}
                style={{
                  backgroundColor: filter === 'incoming' ? greys(theme)[700] : greys(theme)[950],
                  padding: 8,
                  borderRadius: 8,
                  borderWidth: 0.5,
                  borderColor: greys(theme)[700],
                  flex: 1, // Allow the button to grow
                  marginRight: 8, // Add margin to separate buttons
                  alignItems: 'center', // Center the icon inside the container
                }}>
                <Icon
                  name="fluent:arrow-download-16-filled"
                  size={24}
                  color={filter === 'incoming' ? greys(theme)[0] : greys(theme)[500]}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => toggleFilter('outgoing')}
                style={{
                  backgroundColor: filter === 'outgoing' ? greys(theme)[700] : greys(theme)[950],
                  padding: 8,
                  borderRadius: 8,
                  borderWidth: 0.5,
                  borderColor: greys(theme)[700],
                  flex: 1, // Allow the button to grow
                  alignItems: 'center', // Center the icon inside the container
                }}>
                <Icon
                  name="fluent:arrow-upload-16-filled"
                  size={24}
                  color={filter === 'outgoing' ? greys(theme)[0] : greys(theme)[500]}
                />
              </TouchableOpacity>
            </View>
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
