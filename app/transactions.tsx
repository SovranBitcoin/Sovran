import { View } from 'components/common/View';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedRoute } from 'helper/navigation';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { useState } from 'react';
import { Transactions } from 'components/layout/Transactions';
import Container from 'components/layout/Container';
import CurrencySelector from 'components/layout/CurrencySelector';
import Icon from 'assets/icons';
import { ScrollView } from 'react-native';
import { Tabs } from 'components/common/Tabs';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const { account } = useTypedRoute<'transactions'>() || {
    account: { unit: '' },
  };
  const [selectedCurrency, setSelectedCurrency] = useState(account.unit);
  const [filter, setFilter] = useState<'all' | 'incoming' | 'outgoing'>('all');
  const [type, setType] = useState<string>('all');
  const [at, setAt] = useState<string>('all');
  const [tab, setTab] = useState('All');

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

  return (
    <Container>
      <ScrollView>
        <Tabs tabs={['All', 'Confirmed', 'Pending']} selectedTab={tab} handleTabPress={setTab} />

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
              backgroundColor: at === 'at' ? theme.greys[1500] : theme.greys[2300],
              padding: 8,
              borderRadius: 8,
              borderWidth: 0.5,
              borderColor: theme.greys[1500],
              flex: 1, // Allow the button to grow
              marginRight: 8, // Add margin to separate buttons
              alignItems: 'center', // Center the icon inside the container
            }}>
            <Icon
              name="mdi:at" // Assuming this is the lightning icon
              size={24}
              color={at === 'at' ? theme.greys[0] : theme.greys[1000]}
            />
          </TouchableOpacity>
          <View
            style={{
              width: 1,
              marginRight: 8,
              height: 16,
              backgroundColor: theme.greys[1500],
            }}
          />
          <TouchableOpacity
            onPress={() => toggleType('lightning')}
            style={{
              backgroundColor: type === 'lightning' ? theme.greys[1500] : theme.greys[2300],
              padding: 8,
              borderRadius: 8,
              borderWidth: 0.5,
              borderColor: theme.greys[1500],
              flex: 1, // Allow the button to grow
              marginRight: 8, // Add margin to separate buttons
              alignItems: 'center', // Center the icon inside the container
            }}>
            <Icon
              name="mingcute:lightning-fill" // Assuming this is the lightning icon
              size={24}
              color={type === 'lightning' ? theme.greys[0] : theme.greys[1000]}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => toggleType('ecash')}
            style={{
              backgroundColor: type === 'ecash' ? theme.greys[1500] : theme.greys[2300],
              padding: 8,
              borderRadius: 8,
              borderWidth: 0.5,
              borderColor: theme.greys[1500],
              flex: 1, // Allow the button to grow
              marginRight: 8, // Add margin to separate buttons
              alignItems: 'center', // Center the icon inside the container
            }}>
            <Icon
              name="majesticons:coins" // Assuming this is the ecash icon or a coins icon
              size={24}
              color={type === 'ecash' ? theme.greys[0] : theme.greys[1000]}
            />
          </TouchableOpacity>
          <View
            style={{
              width: 1,
              marginRight: 8,
              height: 16,
              backgroundColor: theme.greys[1500],
            }}
          />
          <TouchableOpacity
            onPress={() => toggleFilter('incoming')}
            style={{
              backgroundColor: filter === 'incoming' ? theme.greys[1500] : theme.greys[2300],
              padding: 8,
              borderRadius: 8,
              borderWidth: 0.5,
              borderColor: theme.greys[1500],
              flex: 1, // Allow the button to grow
              marginRight: 8, // Add margin to separate buttons
              alignItems: 'center', // Center the icon inside the container
            }}>
            <Icon
              name="fluent:arrow-download-16-filled"
              size={24}
              color={filter === 'incoming' ? theme.greys[0] : theme.greys[1000]}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => toggleFilter('outgoing')}
            style={{
              backgroundColor: filter === 'outgoing' ? theme.greys[1500] : theme.greys[2300],
              padding: 8,
              borderRadius: 8,
              borderWidth: 0.5,
              borderColor: theme.greys[1500],
              flex: 1, // Allow the button to grow
              alignItems: 'center', // Center the icon inside the container
            }}>
            <Icon
              name="fluent:arrow-upload-16-filled"
              size={24}
              color={filter === 'outgoing' ? theme.greys[0] : theme.greys[1000]}
            />
          </TouchableOpacity>
        </View>
        <Transactions
          account={{
            ...account,
            unit: selectedCurrency,
          }}
          filter={filter}
          type={type}
          at={at}
          tab={tab}
          showMore={false}
        />
      </ScrollView>
    </Container>
  );
}

export default withSheetProvider(ModalScreen);
