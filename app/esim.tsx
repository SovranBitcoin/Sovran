import { StyleSheet } from 'react-native';
import { Linking } from 'react-native';
import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigation, useRoute } from '@react-navigation/native';
import lookup from 'country-code-lookup';

import { greys, reds } from 'helper/colors';
import Modal from 'components/layout/Modal';
import { Text, View } from 'components/common/Themed';
import { FlagIcon, ShareIcon } from 'assets/icons';
import { useEsims } from 'helper/redux/esim';
import { memoizedGetTheme } from 'helper/redux/settings';
import DonutChartContainer from 'components/layout/Donut';
import { truncateMiddle } from 'helper/strings';
import React from 'react';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Section } from 'components/common/Section';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

// Move utility function outside of component
export function convertDataUsage(data) {
  const totalVolume = data.volume; // in bytes
  const orderUsage = data.orderUsage || 0; // in bytes
  const dataLeft = totalVolume - orderUsage;

  const GB = 1024 * 1024 * 1024;
  const MB = 1024 * 1024;
  const KB = 1024;

  const gbTotal = (totalVolume / GB).toFixed(2);
  const mbTotal = ((totalVolume % GB) / MB).toFixed(2);
  const kbTotal = ((totalVolume % MB) / KB).toFixed(2);
  const bytesTotal = (totalVolume % KB).toFixed(2);

  const gbLeft = (dataLeft / GB).toFixed(2);
  const mbLeft = ((dataLeft % GB) / MB).toFixed(2);
  const kbLeft = ((dataLeft % MB) / KB).toFixed(2);
  const bytesLeft = (dataLeft % KB).toFixed(2);
  const percentageUsed = ((orderUsage / totalVolume) * 100).toFixed(2);

  return {
    total: {
      gb: parseFloat(gbTotal),
      mb: parseFloat(mbTotal),
      kb: parseFloat(kbTotal),
      bytes: parseFloat(bytesTotal),
    },
    remaining: {
      gb: parseFloat(gbLeft),
      mb: parseFloat(mbLeft),
      kb: parseFloat(kbLeft),
      bytes: parseFloat(bytesLeft),
      percentageUsed: parseFloat(percentageUsed),
    },
  };
}

// API functions moved out of component for cleaner organization
const fetchOrderData = async (esim) => {
  const baseUrl = 'https://esim.sovran.cash/api/order';
  const params = new URLSearchParams({
    request: esim.request,
    packageCode: esim.package.packageCode,
  });

  if (esim.type === 'TOPUP' && esim?.iccid) {
    params.append('slug', esim.package.slug);
    params.append('iccid', esim.iccid);
    params.append('type', 'TOPUP');
  }

  const response = await fetch(`${baseUrl}?${params}`);
  return response.json();
};

const fetchEsimData = async (orderNo) => {
  const response = await fetch(`https://esim.sovran.cash/api/order/query?orderNo=${orderNo}`);
  return response.json();
};

function ModalScreen() {
  const [loadingEsim, setLoadingEsim] = useState(false);
  const { updateEsim } = useEsims();
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useNavigation();
  const { params } = useRoute();

  const esim = useSelector((state) =>
    state.esim?.esims?.find((esim) => esim.request === params.request)
  );

  const fetchAndUpdateEsims = async (esim) => {
    try {
      setLoadingEsim(true);
      const orderData = await fetchOrderData(esim);
      const orderNo = orderData?.obj?.orderNo || esim.order.orderNo;
      if (orderNo) {
        const esimData = await fetchEsimData(orderNo);
        updateEsim(esim.request, esimData.obj.esimList[0]);
      }
    } catch (error) {
    } finally {
      setLoadingEsim(false);
    }
  };

  useEffect(() => {
    if (esim) {
      fetchAndUpdateEsims(esim);
    }
  }, [esim]);

  const getDataUsageChartData = () => {
    if (!esim) return [];

    const usage = convertDataUsage({
      ...esim.order,
      ...esim,
      ...esim.package,
      package: JSON.stringify(esim.package),
    });

    const usedGB = usage.total.gb - usage.remaining.gb;
    return [
      {
        amount: usage.total.gb.toFixed(2),
        label: 'Remaining',
        value: `${usedGB.toFixed(2)} GB`,
      },
      {
        amount: usage.remaining.gb.toFixed(2),
        label: 'Used',
        value: `${usage.remaining.gb.toFixed(2)} GB`,
      },
    ];
  };

  const handleInstallEsim = () => {
    if (!esim?.order?.ac) return;

    Linking.openURL(
      'https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=' + esim.order.ac
    ).catch((err) => {});
  };

  const handleShareEsim = () => {
    navigation.navigate('EsimShare', {
      esimCode: esim.order.qrCodeUrl,
      location: esim.package.location,
      esimLink: esim.order.shortUrl,
    });
  };

  if (!esim) return null;

  const usageData = convertDataUsage({
    ...esim.order,
    ...esim,
    ...esim.package,
    package: JSON.stringify(esim.package),
  });

  const canShareOrInstall =
    !['IN_USE'].includes(esim?.order?.esimStatus) && !['ENABLED'].includes(esim?.order?.smdpStatus);

  const hasActivationCode = esim?.order?.ac;

  return (
    <Modal
      title="Data plan"
      showClose
      children={
        <>
          <View style={styles.chartContainer}>
            <DonutChartContainer
              data={[
                {
                  amount: usageData.remaining.gb,
                  label: 'Remaining',
                  value: `${usageData.remaining.gb.toFixed(2)} GB`,
                },
                {
                  amount: usageData.total.gb - usageData.remaining.gb,
                  label: 'Used',
                  value: `${usageData.total.gb.toFixed(2)} GB`,
                },
              ]}
              titleText="Data Usage"
              totalValueSuffix="GB"
              disableItems={true}
              isSpecialCase={true}
            />
          </View>

          <Section
            items={[
              {
                title: 'Location',
                value: (
                  <View style={styles.locationContainer}>
                    <FlagIcon width={24} height={24} country={esim.package.location} />
                    <Text style={styles.locationText}>
                      {lookup.byIso(esim.package.location).country}
                    </Text>
                  </View>
                ),
              },
              {
                title: 'Data remaining',
                value: `${usageData.remaining.gb} GB`,
              },
              {
                title: 'Total data',
                value: `${usageData.total.gb} GB`,
              },
              {
                title: 'Validity',
                value: `${esim.package.duration} days`,
              },
              {
                title: 'Speed',
                value: esim.package.speed,
              },
              {
                title: 'Status',
                value: esim?.order?.esimStatus,
              },
              {
                title: 'SMDP Status',
                value: esim?.order?.smdpStatus,
              },
            ]}
          />

          {esim?.order?.iccid && (
            <Section
              items={[
                {
                  title: 'ICCID',
                  value: esim.order.iccid,
                },
              ]}
            />
          )}

          {esim?.request && (
            <Section
              items={[
                {
                  title: 'Request',
                  value: truncateMiddle(esim.request, 5),
                },
              ]}
            />
          )}

          <View style={styles.warningContainer}>
            <Text style={styles.warningText}>
              If you delete an eSIM from your phone's settings, you'll lose access to it
              permanently.
            </Text>
          </View>
        </>
      }
      buttons={
        <>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'transparent',
              paddingBottom: 8,
            }}>
            <ButtonHandler
              buttons={[
                ...(canShareOrInstall && hasActivationCode
                  ? [
                      {
                        text: 'Share',
                        icon: <ShareIcon />,
                        variant: 'secondary',
                        onPress: handleShareEsim,
                        disabled: !hasActivationCode,
                      },
                      {
                        text: 'Install',
                        variant: 'primary',
                        onPress: handleInstallEsim,
                        disabled: !hasActivationCode,
                      },
                    ]
                  : []),
                ...(canShareOrInstall && !hasActivationCode
                  ? [
                      {
                        text: 'Activate eSIM',
                        variant: 'primary',
                        onPress: () => fetchAndUpdateEsims(esim),
                        disabled: loadingEsim,
                      },
                    ]
                  : []),
              ]}
            />
          </View>
        </>
      }
    />
  );
}

export default withSheetProvider(ModalScreen);

const createStyles = (theme) =>
  StyleSheet.create({
    chartContainer: {
      marginBottom: 20,
    },
    locationContainer: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'transparent',
    },
    locationText: {
      marginLeft: 4,
      fontSize: 16,
    },
    warningContainer: {
      backgroundColor: greys(theme)[1800],
      borderLeftWidth: 5,
      borderLeftColor: reds[300],
      padding: 15,
      borderRadius: 8,
      marginVertical: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
      margin: 16,
      marginBottom: 32,
    },
    warningText: {
      color: reds[300],
      fontSize: 16,
      fontWeight: '500',
    },
  });
