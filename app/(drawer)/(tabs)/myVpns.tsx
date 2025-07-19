import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView } from 'react-native';
import lookup from 'country-code-lookup';
import { useSelector } from 'react-redux';

import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import CircularProgress from 'components/common/CircleProgress';

import { useCashu } from 'helper/redux/cashu';
import { greys } from 'helper/colors';
import { useVpn } from 'helper/redux/lnvpn';
import { memoizedGetTheme } from 'helper/redux/settings';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Tabs } from 'components/common/Tabs';
import { showMessage } from 'helper/popup/popups';
import { fetchVpnCountries } from 'helper/apiClient';
import { useTypedNavigation } from 'helper/navigation';

function TabTwoScreen() {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();
  const { transactions: cashuTransactions } = useCashu();
  const { vpn } = useVpn();
  const [fetchingPackages, setFetchingPackages] = useState(false);
  const [selectedTab, setSelectedTab] = useState('New');

  const paidVpns = vpn.filter((vpn: any) =>
    cashuTransactions.some((tx: any) => {
      if (tx.request && vpn.payment_request && tx.request === vpn.payment_request && tx.paid) {
        return true;
      }
      return false;
    })
  );

  const currentDate = new Date();
  const nonActiveVpns = paidVpns.filter((vpn: any) => !vpn?.order?.expiry_date);
  const nonExpiredVpns = paidVpns.filter(
    (vpn: any) => new Date(vpn?.order?.expiry_date) > currentDate
  );
  const expiredVpns = paidVpns.filter(
    (vpn: any) => new Date(vpn?.order?.expiry_date) <= currentDate
  );

  const amounts: string[] = [
    nonActiveVpns.length > 99 ? '99+' : String(nonActiveVpns.length),
    nonExpiredVpns.length > 99 ? '99+' : String(nonExpiredVpns.length),
    expiredVpns.length > 99 ? '99+' : String(expiredVpns.length),
  ];

  const fetchPackages = async () => {
    const result = await fetchVpnCountries();

    if (result.isErr()) {
      showMessage('vpns_error', {}, { emoji: '🚨' });
      return null;
    }

    const data = result.value;
    setFetchingPackages(data);
    return data;
  };

  const handleGetDataPress = async () => {
    setFetchingPackages(true);
    const countries = await fetchPackages();
    if (countries) {
      navigation.navigate('vpns', { countries: countries });
    }
    setFetchingPackages(false);
  };

  return (
    <View
      className="flex-1"
      style={{
        paddingTop: 96,
        backgroundColor: greys(theme)[950],
      }}>
      <Text size={32} className="mb-1 ml-4" overpass heavy>
        VPNs
      </Text>
      <View className="px-4">
        <Tabs
          tabs={['New', 'Active', 'Expired']}
          amounts={amounts}
          selectedTab={selectedTab}
          handleTabPress={setSelectedTab}
        />
      </View>
      <ScrollView className="mt-1 flex-1 px-4">
        {selectedTab === 'New' &&
          (nonActiveVpns.length > 0 ? (
            nonActiveVpns.map((vpn: any) => {
              return <VpnItem vpn={vpn} navigation={navigation} key={vpn.id} />;
            })
          ) : (
            <Text
              className="mb-4"
              size={14}
              style={{
                color: greys(theme)[200],
              }}>
              No inactive VPNs
            </Text>
          ))}

        {selectedTab === 'Active' &&
          (nonExpiredVpns.length > 0 ? (
            nonExpiredVpns.map((vpn: any) => {
              return <VpnItem vpn={vpn} navigation={navigation} key={vpn.id} />;
            })
          ) : (
            <Text
              className="mb-4"
              size={14}
              style={{
                color: greys(theme)[200],
              }}>
              No active VPNs
            </Text>
          ))}

        {selectedTab === 'Expired' &&
          (expiredVpns.length > 0 ? (
            expiredVpns.map((vpn: any) => {
              return <VpnItem vpn={vpn} navigation={navigation} key={vpn.id} />;
            })
          ) : (
            <Text
              className="mb-4"
              size={14}
              style={{
                color: greys(theme)[200],
              }}>
              No expired VPNs
            </Text>
          ))}
      </ScrollView>
      <ButtonHandler
        context="tab"
        buttons={[
          {
            text: 'Get a VPN',
            variant: 'primary',
            loading: fetchingPackages,
            onPress: handleGetDataPress,
          },
        ]}
      />
    </View>
  );
}

const calculateProgress = (startDate: any, expiryDate: any) => {
  if (!startDate || !expiryDate) {
    return 0;
  }

  const start = new Date(startDate).getTime();
  const expiry = new Date(expiryDate).getTime();
  const currentDate = new Date().getTime();

  if (currentDate >= expiry) {
    return 100;
  }

  if (isNaN(start) || isNaN(expiry)) {
    return 0;
  }

  const totalDuration = expiry - start;
  const elapsedDuration = currentDate - start;
  const progress = (elapsedDuration / totalDuration) * 100;

  return progress;
};

const VpnItem = ({ vpn, navigation }: { vpn: any; navigation: any }) => {
  const theme = useSelector(memoizedGetTheme);
  const countryName = lookup.byIso(vpn.location)?.country;

  const handlePress = () => {
    navigation.navigate('vpn', {
      ...vpn,
    });
  };

  const [progress, setProgress] = useState(0);
  const [remainingTime, setRemainingTime] = useState('VPN'); // Default text

  useEffect(() => {
    const interval = setInterval(() => {
      const expiry = vpn?.order?.expiry_date;
      if (expiry) {
        const prog = calculateProgress(vpn?.order?.ordered_at, expiry);
        setProgress(prog);

        const currentDate = new Date().getTime();
        const expiryDate = new Date(expiry).getTime();

        if (expiryDate > currentDate) {
          const timeDiff = expiryDate - currentDate;

          const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
          const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));

          if (days > 0) {
            setRemainingTime(`${days} days remaining`);
          } else if (hours > 0) {
            setRemainingTime(`${hours} hours remaining`);
          } else if (minutes > 0) {
            setRemainingTime(`${minutes} minutes remaining`);
          } else {
            setRemainingTime('Expired');
          }
        } else {
          setRemainingTime('Expired');
        }
      } else {
        setRemainingTime('VPN'); // Default if no expiry date
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [vpn]);

  return (
    <Pressable
      className="mb-4 flex-row items-center rounded-2xl p-3"
      style={{
        backgroundColor: greys(theme)[800],
        borderColor: greys(theme)[600],
        borderWidth: 0.2,
      }}
      onPress={handlePress}>
      <View className="flex-row items-center justify-between bg-transparent">
        <CircularProgress country={vpn.location} progress={progress} />
      </View>
      <View className="ml-3 flex-1 bg-transparent">
        <Text size={14} overpass regular style={{ color: greys(theme)[200] }}>
          {countryName}
        </Text>
        <Text overpass bold size={18}>
          {vpn?.order?.expiry_date
            ? new Date(vpn?.order?.expiry_date).toLocaleString()
            : 'Not activated'}
        </Text>
        <Text className="mt-3" size={14} overpass regular>
          {remainingTime}
        </Text>
      </View>
    </Pressable>
  );
};

export default TabTwoScreen;
