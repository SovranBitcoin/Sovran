import React from 'react';
import { useState, useEffect } from 'react';
import { Pressable, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import lookup from 'country-code-lookup';
import { useSelector } from 'react-redux';
import Modal from 'components/layout/Modal';
import { Text, View } from 'components/common/Themed';
import CircularProgress from 'components/common/CircleProgress';
import { useEsims } from 'helper/redux/esim';
import { useCashu } from 'helper/redux/cashu';
import { convertDataUsage } from '../../../app/esim';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { convertTimeData } from 'helper/time';
import { showMessage } from 'helper/popup/popups';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Tabs } from 'components/common/Tabs';
import { fetchProducts } from 'helper/api/sovran';


// Separate component for eSIM item
const EsimItem = ({ esim, navigation }) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const handlePress = () => {
    const { package: p, order: o } = esim;
    navigation.navigate('esim', {
      ...p,
      ...esim,
      ...o,
      package: JSON.stringify(p),
    });
  };

  const countryName = lookup.byIso(esim.package.location)?.country;

  const getDataRemaining = () => {
    if (!esim?.order?.totalVolume) return '';

    const { remaining } = convertDataUsage({
      ...esim.order,
      ...esim,
      ...esim.package,
      package: JSON.stringify(esim.package),
    });

    return `${remaining.gb || 0} GB`;
  };

  const getExpirationText = () => {
    if (esim?.order?.activateTime) {
      return `on ${convertTimeData(esim.order)?.expiredTime}`;
    }
    return `${esim?.order?.totalDuration} days after installation`;
  };

  const remainingData = getDataRemaining();
  const expiresOn = getExpirationText();

  const getDataUsagePercentage = () => {
    if (!esim?.order?.totalVolume) return 0;

    return convertDataUsage({
      ...esim.order,
      ...esim,
      ...esim.package,
      package: JSON.stringify(esim.package),
    }).remaining.percentageUsed;
  };

  return (
    <Pressable style={styles.esimItem} onPress={handlePress}>
      <View style={styles.progressContainer}>
        <CircularProgress country={esim.package.location} progress={getDataUsagePercentage()} />
      </View>
      <View style={styles.esimInfo}>
        <Text style={styles.countryText}>{countryName}</Text>
        <Text style={styles.remainingDataText}>
          {remainingData ? `${remainingData} remaining` : 'Not activated'}
        </Text>
        <Text style={styles.expirationText}>{remainingData ? `Expires ${expiresOn}` : 'eSIM'}</Text>
      </View>
    </Pressable>
  );
};

// Section component for better organization
const EsimSection = ({ title, esims, navigation }) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <>
      {/* <Text style={styles.sectionTitle}>{title}</Text> */}
      {esims.length > 0 ? (
        esims.map((esim) => <EsimItem esim={esim} navigation={navigation} key={esim.request} />)
      ) : (
        <Text style={styles.noItemsText}>No {title.toLowerCase()}</Text>
      )}
    </>
  );
};

// Main component
function EsimsScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useNavigation();
  const { transactions: cashuTransactions } = useCashu();
  const { esims } = useEsims();
  const [fetchingPackages, setFetchingPackages] = useState(false);
  const [packageList, setPackageList] = useState(null);
  const [selectedTab, setSelectedTab] = useState('New'); // State for selected tab

  // Filter eSIMs by payment status
  const paidEsims = esims.filter((esim) =>
    cashuTransactions.some((tx) => tx.request === esim.request && tx.paid)
  );

  // Categorize eSIMs
  const currentDate = new Date();
  const categorizedEsims = categorizeEsims(paidEsims, currentDate);

  // Fetch packages from API
  const fetchPackages = async () => {
    try {
      const data = await fetchProducts();

      if (data.success && data.obj?.packageList) {
        setPackageList(data.obj.packageList);
        return data.obj.packageList;
      }
      return null;
    } catch (error) {
      showMessage('esim_error', {}, { emoji: '🚨' });
      return null;
    }
  };

  // Initial fetch on component mount
  useEffect(() => {
    fetchPackages();
  }, []);

  // Handle data plan selection
  const handleGetDataPress = async () => {
    setFetchingPackages(true);

    try {
      let packages = packageList || (await fetchPackages());

      if (packages) {
        navigateToPackageSelection(packages);
      }
    } finally {
      setFetchingPackages(false);
    }
  };

  // Navigation helper
  const navigateToPackageSelection = (packageList) => {
    const countries = [...new Set(packageList.map((r) => r.slug.split('_')[0]))];

    navigation.navigate('esimsDataPlan', {
      type: 'BASE',
      packageList,
      countries,
      country: 'US',
    });
  };

  const amounts = [
    categorizedEsims.new.length
      ? categorizedEsims.new.length > 99
        ? '99+'
        : categorizedEsims.new.length
      : 0,
    categorizedEsims.active.length
      ? categorizedEsims.active.length > 99
        ? '99+'
        : categorizedEsims.active.length
      : 0,
    categorizedEsims.expired.length
      ? categorizedEsims.expired.length > 99
        ? '99+'
        : categorizedEsims.expired.length
      : 0,
  ];

  return (
    <Modal
      showBack={false}
      showHeader={false}
      childrenStyles={styles.modalContent}
      buttons={
        <ButtonHandler
          context={'tab'}
          buttons={[
            {
              text: 'Get Data',
              variant: 'primary',
              loading: fetchingPackages,
              onPress: handleGetDataPress,
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
        eSIMs
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
        {selectedTab === 'New' && (
          <EsimSection title="New eSIMs" esims={categorizedEsims.new} navigation={navigation} />
        )}
        {selectedTab === 'Active' && (
          <EsimSection
            title="Installed eSIMs"
            esims={categorizedEsims.active}
            navigation={navigation}
          />
        )}
        {selectedTab === 'Expired' && (
          <EsimSection
            title="Expired eSIMs"
            esims={categorizedEsims.expired}
            navigation={navigation}
          />
        )}
      </ScrollView>
    </Modal>
  );
}

// Helper function to categorize eSIMs
function categorizeEsims(paidEsims, currentDate) {
  return {
    new: paidEsims.filter((esim) => !esim.order || !esim.order.activateTime),
    active: paidEsims.filter(
      (esim) =>
        esim?.order?.esimStatus === 'IN_USE' ||
        (esim?.order?.activateTime &&
          new Date(convertTimeData(esim.order).expiredTime) > currentDate)
    ),
    expired: paidEsims.filter(
      (esim) =>
        esim?.order?.activateTime &&
        new Date(convertTimeData(esim.order).expiredTime) <= currentDate
    ),
  };
}

// Styles
const createStyles = (theme) =>
  StyleSheet.create({
    modalContent: {
      flex: 1,
    },
    scrollView: {
      padding: 16,
      paddingTop: 4,
      flex: 1,
    },
    esimItem: {
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
    esimInfo: {
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

export default EsimsScreen;
