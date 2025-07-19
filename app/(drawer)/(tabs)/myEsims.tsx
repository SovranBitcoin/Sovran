import React, { useState, useEffect } from 'react';
import { Pressable, ScrollView } from 'react-native';
import lookup from 'country-code-lookup';
import { useSelector } from 'react-redux';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import CircularProgress from 'components/common/CircleProgress';
import { Esim, useEsims } from 'helper/redux/esim';
import { useCashu } from 'helper/redux/cashu';
import { convertDataUsage } from '../../../app/esim';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { convertTimeData } from 'helper/time';
import { showMessage } from 'helper/popup/popups';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Tabs } from 'components/common/Tabs';
import { fetchProducts, ProductPackage } from 'helper/apiClient';
import { useTypedNavigation } from 'helper/navigation';

// Separate component for eSIM item
const EsimItem = ({ esim }: { esim: Esim }) => {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();

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
      return `on ${
        convertTimeData({
          activateTime: esim.order.activateTime || '',
          expiredTime: esim.order.expiredTime || '',
        })?.expiredTime
      }`;
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
    <Pressable onPress={handlePress}>
      <View
        blur
        className="mb-4 flex-row items-center rounded-2xl p-3"
        style={{
          backgroundColor: greys(theme)[800],
          borderColor: greys(theme)[600],
          borderWidth: 0.2,
        }}>
        <View className="flex-row items-center justify-between bg-transparent">
          <CircularProgress country={esim.package.location} progress={getDataUsagePercentage()} />
        </View>
        <View className="ml-3 flex-1 bg-transparent">
          <Text
            size={14}
            style={{
              color: greys(theme)[200],
            }}>
            {countryName}
          </Text>
          <Text overpass bold size={18}>
            {remainingData ? `${remainingData} remaining` : 'Not activated'}
          </Text>
          <Text
            size={14}
            overpass
            regular
            style={{
              marginTop: 12,
            }}>
            {remainingData ? `Expires ${expiresOn}` : 'eSIM'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
};

// Section component for better organization
const EsimSection = ({ title, esims }: { title: string; esims: Esim[] }) => {
  const theme = useSelector(memoizedGetTheme);

  return (
    <>
      {esims.length > 0 ? (
        esims.map((esim) => <EsimItem esim={esim} key={esim.request} />)
      ) : (
        <Text
          size={14}
          overpass
          regular
          style={{
            color: greys(theme)[200],
            marginBottom: 16,
          }}>
          No {title.toLowerCase()}
        </Text>
      )}
    </>
  );
};

// Main component
function EsimsScreen() {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();
  const { transactions: cashuTransactions } = useCashu();
  const { esims } = useEsims();
  const [fetchingPackages, setFetchingPackages] = useState(false);
  const [packageList, setPackageList] = useState<ProductPackage[]>();
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
    const result = await fetchProducts();

    if (result.isErr()) {
      showMessage('esim_error', {}, { emoji: '🚨' });
      return null;
    }

    const data = result.value;

    if (data.success && data.obj?.packageList) {
      setPackageList(data.obj.packageList);
      return data.obj.packageList;
    }

    return null; // API responded but doesn't contain expected data
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
  const navigateToPackageSelection = (packageList: ProductPackage[]) => {
    const countries = [...new Set(packageList.map((r) => r.slug.split('_')[0]))];

    navigation.navigate('esimsDataPlan', {
      type: 'BASE',
      packageList,
      countries,
      country: 'US',
    });
  };

  const amounts: string[] = [
    categorizedEsims.new.length
      ? categorizedEsims.new.length > 99
        ? '99+'
        : String(categorizedEsims.new.length)
      : '0',
    categorizedEsims.active.length
      ? categorizedEsims.active.length > 99
        ? '99+'
        : String(categorizedEsims.active.length)
      : '0',
    categorizedEsims.expired.length
      ? categorizedEsims.expired.length > 99
        ? '99+'
        : String(categorizedEsims.expired.length)
      : '0',
  ];

  return (
    <View
      className="flex-1"
      style={{
        paddingTop: 96,
        backgroundColor: greys(theme)[950],
      }}>
      <Text
        size={32}
        overpass
        heavy
        style={{
          marginLeft: 16,
          marginBottom: 4,
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
      <ScrollView className="flex-1 px-4 pt-1">
        {selectedTab === 'New' && <EsimSection title="New eSIMs" esims={categorizedEsims.new} />}
        {selectedTab === 'Active' && (
          <EsimSection title="Installed eSIMs" esims={categorizedEsims.active} />
        )}
        {selectedTab === 'Expired' && (
          <EsimSection title="Expired eSIMs" esims={categorizedEsims.expired} />
        )}
      </ScrollView>
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
    </View>
  );
}

// Helper function to categorize eSIMs
function categorizeEsims(paidEsims: Esim[], currentDate: Date) {
  return {
    new: paidEsims.filter((esim) => !esim.order || !esim.order.activateTime),
    active: paidEsims.filter(
      (esim) =>
        esim?.order?.esimStatus === 'IN_USE' ||
        (esim?.order?.activateTime &&
          new Date(
            convertTimeData({
              activateTime: esim.order.activateTime,
              expiredTime: esim.order.expiredTime || '',
            }).expiredTime
          ) > currentDate)
    ),
    expired: paidEsims.filter(
      (esim) =>
        esim?.order?.activateTime &&
        new Date(
          convertTimeData({
            activateTime: esim.order.activateTime,
            expiredTime: esim.order.expiredTime || '',
          }).expiredTime
        ) <= currentDate
    ),
  };
}

export default EsimsScreen;
