import { View, HStack } from 'components/ui/View';
import { useTheme } from 'providers/ThemeProvider';
import { useLocalSearchParams } from 'expo-router';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import React, { useState } from 'react';
import { Transactions } from 'components/blocks/Transactions';
import Container from 'components/blocks/Container';
import CurrencySelector from 'components/blocks/CurrencySelector';
import Icon from 'assets/icons';
import { Tabs } from 'components/ui/Tabs';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { MintHistoryEntry } from 'coco-cashu-core';
import { mintHistoryEntryExpired } from 'helper/utils';
import { usePaginatedHistory } from 'coco-cashu-react';

function ModalScreen() {
  const { getPrimaryColor } = useTheme();
  const { account, tab: tab_ } = useLocalSearchParams<{
    account: string;
    tab: 'All' | 'Incoming' | 'Outgoing';
  }>();
  const [selectedCurrency, setSelectedCurrency] = useState(
    account ? JSON.parse(account).unit : 'sat'
  );
  const [filter, setFilter] = useState<'all' | 'incoming' | 'outgoing'>('all');
  const [type, setType] = useState<'all' | 'lightning' | 'ecash'>('all');
  const [at, setAt] = useState<'all' | 'at'>('all');
  const [tab, setTab] = useState<'All' | 'Confirmed' | 'Pending' | 'Expired'>(
    (tab_ as 'All' | 'Confirmed' | 'Pending' | 'Expired') || 'All'
  );

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

  const { history } = usePaginatedHistory();

  const listKey = `${filter}-${type}-${at}-${tab}-${selectedCurrency}`;

  // Calculate counts for tabs
  const filteredHistory = React.useMemo(() => {
    return history.filter((historyEntry) => {
      if (historyEntry.unit !== selectedCurrency) return false;
      if (filter === 'incoming' && historyEntry.type !== 'mint') return false;
      if (filter === 'outgoing' && historyEntry.type !== 'send') return false;
      if (type === 'lightning' && historyEntry.type !== 'mint') return false;
      if (type === 'ecash' && historyEntry.type !== 'send') return false;
      return true;
    });
  }, [history, selectedCurrency, filter, type]);

  const { pendingCount, confirmedCount, expiredCount } = React.useMemo(() => {
    const expired = filteredHistory.filter((historyEntry) => {
      // Check if it's an unpaid mint transaction that has expired
      return (
        historyEntry.type === 'mint' &&
        historyEntry.state === 'UNPAID' &&
        mintHistoryEntryExpired(historyEntry as MintHistoryEntry)
      );
    });

    const pending = filteredHistory.filter((historyEntry) => {
      const isExpired =
        historyEntry.type === 'mint' &&
        historyEntry.state === 'UNPAID' &&
        mintHistoryEntryExpired(historyEntry as MintHistoryEntry);

      return (
        ((historyEntry.type === 'mint' && historyEntry.state === 'UNPAID') ||
          (historyEntry.type === 'melt' && historyEntry.state === 'UNPAID')) &&
        !isExpired
      );
    });

    const confirmed = filteredHistory.filter((historyEntry) => {
      const isPending =
        (historyEntry.type === 'mint' && historyEntry.state === 'UNPAID') ||
        (historyEntry.type === 'melt' && historyEntry.state === 'UNPAID');

      const isExpired =
        historyEntry.type === 'mint' &&
        historyEntry.state === 'UNPAID' &&
        mintHistoryEntryExpired(historyEntry as MintHistoryEntry);

      return !isPending || isExpired;
    });

    return {
      pendingCount: pending.length,
      confirmedCount: confirmed.length,
      expiredCount: expired.length,
    };
  }, [filteredHistory]);

  const allCount = filteredHistory.length;

  const parsedAccount = account ? JSON.parse(account) : { unit: selectedCurrency };

  return (
    <Container>
      <Transactions
        listKey={listKey}
        account={{ ...parsedAccount, unit: selectedCurrency }}
        showMore={false}
        history={history}
        filter={filter}
        type={type}
        at={at}
        tab={tab}
        header={
          <>
            <Tabs
              tabs={['All', 'Confirmed', 'Pending', 'Expired']}
              selectedTab={tab}
              handleTabPress={(tab) => setTab(tab as 'All' | 'Confirmed' | 'Pending' | 'Expired')}
              amounts={[
                String(allCount),
                String(confirmedCount),
                String(pendingCount),
                String(expiredCount),
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
                className={`rounded-lg border p-2 ${at === 'at' ? 'bg-primary-700' : 'bg-primary-950'} border-primary-700`}>
                <HStack align="center" justify="center">
                  <Icon
                    name="mdi:at" // Assuming this is the lightning icon
                    size={24}
                    color={at === 'at' ? getPrimaryColor('0') : getPrimaryColor('500')}
                  />
                </HStack>
              </TouchableOpacity>
              <View
                className="mr-2 h-4 w-px"
                style={{
                  backgroundColor: getPrimaryColor('700'),
                }}
              />
              <TouchableOpacity
                onPress={() => toggleType('lightning')}
                className="mr-2 flex-1"
                className={`rounded-lg border p-2 ${type === 'lightning' ? 'bg-primary-700' : 'bg-primary-950'} border-primary-700`}>
                <HStack align="center" justify="center">
                  <Icon
                    name="mingcute:lightning-fill" // Assuming this is the lightning icon
                    size={24}
                    color={type === 'lightning' ? getPrimaryColor('0') : getPrimaryColor('500')}
                  />
                </HStack>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => toggleType('ecash')}
                className="mr-2 flex-1"
                className={`rounded-lg border p-2 ${type === 'ecash' ? 'bg-primary-700' : 'bg-primary-950'} border-primary-700`}>
                <HStack align="center" justify="center">
                  <Icon
                    name="majesticons:coins" // Assuming this is the ecash icon or a coins icon
                    size={24}
                    color={type === 'ecash' ? getPrimaryColor('0') : getPrimaryColor('500')}
                  />
                </HStack>
              </TouchableOpacity>
              <View
                className="mr-2 h-4 w-px"
                style={{
                  backgroundColor: getPrimaryColor('700'),
                }}
              />
              <TouchableOpacity
                onPress={() => toggleFilter('incoming')}
                className="mr-2 flex-1"
                className={`rounded-lg border p-2 ${filter === 'incoming' ? 'bg-primary-700' : 'bg-primary-950'} border-primary-700`}>
                <HStack align="center" justify="center">
                  <Icon
                    name="fluent:arrow-download-16-filled"
                    size={24}
                    color={filter === 'incoming' ? getPrimaryColor('0') : getPrimaryColor('500')}
                  />
                </HStack>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => toggleFilter('outgoing')}
                className="flex-1"
                className={`rounded-lg border p-2 ${filter === 'outgoing' ? 'bg-primary-700' : 'bg-primary-950'} border-primary-700`}>
                <HStack align="center" justify="center">
                  <Icon
                    name="fluent:arrow-upload-16-filled"
                    size={24}
                    color={filter === 'outgoing' ? getPrimaryColor('0') : getPrimaryColor('500')}
                  />
                </HStack>
              </TouchableOpacity>
            </HStack>
          </>
        }
      />
    </Container>
  );
}

export default withSheetProvider(ModalScreen);
