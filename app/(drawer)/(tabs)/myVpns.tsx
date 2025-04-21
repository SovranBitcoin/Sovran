import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import lookup from 'country-code-lookup';
import { useSelector } from 'react-redux';

import Modal from 'components/layout/Modal';
import { Text, View } from 'components/common/Themed';
import CircularProgress from 'components/common/CircleProgress';

import { useCashu } from 'helper/redux/cashu';
import { greys } from 'helper/colors';
import { useVpn } from 'helper/redux/lnvpn';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Tabs } from './payments';
import { ButtonHandler } from 'app/ecashSendConfirmation';

function TabTwoScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useNavigation();
  const { transactions: cashuTransactions } = useCashu();
  const { vpn } = useVpn();
  const [fetchingPackages, setFetchingPackages] = useState(false);
  const [selectedTab, setSelectedTab] = useState('New'); // State for selected tab

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

  const amounts = [
    nonActiveVpns.length > 99 ? '99+' : nonActiveVpns.length,
    nonExpiredVpns.length > 99 ? '99+' : nonExpiredVpns.length,
    expiredVpns.length > 99 ? '99+' : expiredVpns.length,
  ];

  return (
    <Modal
      showBack={false}
      childrenStyles={styles.modalContent}
      showHeader={false}
      buttons={
        <ButtonHandler
          context="tab"
          buttons={[
            {
              text: 'Get a VPN',
              variant: 'primary',
              onPress: () => navigation.navigate('vpns'),
            },
          ]}
        />
      }>
      <Text
        size={32}
        style={{
          fontFamily: 'OverpassHeavy',
          marginLeft: 16,
          marginBottom: 4,
          marginTop: 4,
        }}>
        VPNs
      </Text>
      <View
        style={{
          paddingHorizontal: 16,
        }}>
        <Tabs
          tabs={['New', 'Active', 'Expired']}
          amounts={amounts}
          selectedTab={selectedTab}
          handleTabPress={setSelectedTab}
        />
      </View>
      <ScrollView style={styles.scrollView}>
        {selectedTab === 'New' &&
          (nonActiveVpns.length > 0 ? (
            nonActiveVpns.map((vpn: any) => {
              return <VpnItem vpn={vpn} navigation={navigation} key={vpn.id} />;
            })
          ) : (
            <Text style={styles.noItemsText}>No inactive VPNs</Text>
          ))}

        {selectedTab === 'Active' &&
          (nonExpiredVpns.length > 0 ? (
            nonExpiredVpns.map((vpn: any) => {
              return <VpnItem vpn={vpn} navigation={navigation} key={vpn.id} />;
            })
          ) : (
            <Text style={styles.noItemsText}>No active VPNs</Text>
          ))}

        {selectedTab === 'Expired' &&
          (expiredVpns.length > 0 ? (
            expiredVpns.map((vpn: any) => {
              return <VpnItem vpn={vpn} navigation={navigation} key={vpn.id} />;
            })
          ) : (
            <Text style={styles.noItemsText}>No expired VPNs</Text>
          ))}
      </ScrollView>
    </Modal>
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
  const styles = createStyles(theme);
  const countryName = lookup.byIso(vpn.location)?.country;

  const handlePress = () => {
    const { package: p, order: o } = vpn;
    navigation.navigate('vpn', {
      ...vpn,
    });
  };

  const [expiryDate, setExpiryDate] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [remainingTime, setRemainingTime] = useState('VPN'); // Default text

  useEffect(() => {
    const interval = setInterval(() => {
      const expiry = vpn?.order?.expiry_date;
      if (expiry) {
        setExpiryDate(new Date(expiry).toISOString());
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
    <Pressable style={styles.vpnItem} onPress={handlePress}>
      <View style={styles.progressContainer}>
        <CircularProgress country={vpn.location} progress={progress} />
      </View>
      <View style={styles.vpnInfo}>
        <Text style={styles.countryText}>{countryName}</Text>
        <Text style={styles.remainingDataText}>
          {vpn?.order?.expiry_date
            ? new Date(vpn?.order?.expiry_date).toLocaleString()
            : 'Not activated'}
        </Text>
        <Text style={styles.expirationText}>{remainingTime}</Text>
      </View>
    </Pressable>
  );
};

export default TabTwoScreen;

const createStyles = (theme: any) =>
  StyleSheet.create({
    modalContent: {
      flex: 1,
    },
    scrollView: {
      paddingHorizontal: 16,
      marginTop: 4,
      flex: 1,
    },
    vpnItem: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
      padding: 12,
      borderRadius: 16,
      backgroundColor: greys(theme)[1800],
      borderColor: greys(theme)[1300],
      borderWidth: 0.2,
    },
    progressContainer: {
      alignItems: 'center',
      backgroundColor: 'transparent',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    vpnInfo: {
      backgroundColor: 'transparent',
      marginLeft: 12,
      flex: 1,
    },
    countryText: {
      fontSize: 14,
      color: greys(theme)[400],
    },
    remainingDataText: {
      fontSize: 18,
      fontFamily: 'OverpassBold',
    },
    expirationText: {
      marginTop: 12,
      fontSize: 14,
      fontFamily: 'OverpassRegular',
    },
    buttonContainer: {
      margin: 16,
      marginBottom: 42,
      backgroundColor: 'transparent',
    },
    sectionTitle: {
      fontSize: 16,
      fontFamily: 'OverpassHeavy',
      marginBottom: 8,
      color: greys(theme)[200],
    },
    noItemsText: {
      fontSize: 14,
      color: greys(theme)[400],
      marginBottom: 16,
    },
  });
