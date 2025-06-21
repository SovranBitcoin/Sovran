import { StyleSheet, Alert } from 'react-native';
import type { WireGuardStatus } from 'react-native-wireguard-vpn';

import { greys } from 'helper/colors';
import Modal from 'components/layout/Modal';
import { Text, View } from 'components/common/Themed';
import { FlagIcon, ShareIcon } from 'assets/icons';
import { useEffect, useState } from 'react';
import lookup from 'country-code-lookup';
import { useSelector } from 'react-redux';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useVpn } from 'helper/redux/lnvpn';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { memoizedGetTheme } from 'helper/redux/settings';
import { truncateMiddle } from 'helper/strings';
import { showMessage } from 'helper/popup/popups';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Section } from 'components/common/Section';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { activateVpn } from 'helper/api/sovran';
import {
  initializeVpn,
  connectVpn,
  disconnectVpn,
  getVpnStatus,
  parseWireGuardConfig,
} from 'helper/vpn/wireguard';

export function convertDataUsage(data) {
  const totalVolume = data.totalVolume; // in bytes
  const orderUsage = data.orderUsage; // in bytes

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

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const { params } = useRoute();
  const navigation = useNavigation();
  const [query, setQuery] = useState();
  const [fetchingPackages, setFetchingPackages] = useState(false);
  const { vpn, updateVpn } = useVpn();
  const [vpnStatus, setVpnStatus] = useState<WireGuardStatus | null>(null);

  const activateVPN = async () => {
    try {
      const data = await activateVpn({
        paymentHash: params.payment_hash,
        location: params.cc,
      });

      const orderedAt = new Date();
      let expiryDate;
      switch (params.duration) {
        case '1 hour':
          expiryDate = new Date(orderedAt.getTime() + 60 * 60 * 1000);
          break;
        case '1 day':
          expiryDate = new Date(orderedAt.getTime() + 24 * 60 * 60 * 1000);
          break;
        case '1 week':
          expiryDate = new Date(orderedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
          break;
        case '1 month':
          expiryDate = new Date(orderedAt.setMonth(orderedAt.getMonth() + 1));
          break;
        case '3 months':
          expiryDate = new Date(orderedAt.setMonth(orderedAt.getMonth() + 3));
          break;
        default:
          expiryDate = orderedAt;
      }
      updateVpn(params.payment_request, {
        ...data,
        ordered_at: orderedAt.toISOString(),
        expiry_date: expiryDate.toISOString(),
      });
    } catch (error) {
      showMessage('activation_failed', {}, { emoji: '🚨' });
    }
  };

  const downloadAndShareVPN = async () => {
    const vpnCode = vpn
      ?.find((v) => v.payment_request === params.payment_request)
      ?.order?.WireguardConfig.join('\n');

    const hash = vpn?.find((v) => v.payment_request === params.payment_request)?.payment_hash;

    try {
      // Save the file in the app's document directory first
      const path = FileSystem.documentDirectory + `vpn_${hash}.conf`;
      await FileSystem.writeAsStringAsync(path, vpnCode, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      // Check if the Sharing API is available and use it
      if (!(await Sharing.isAvailableAsync())) {
        showMessage('sharing_unavailable', {}, { emoji: '⚠️' });
        return;
      }

      // Open the sharing dialog to let the user choose where to save
      await Sharing.shareAsync(path);
      // showMessage("VPN configuration shared", path, null, null);
    } catch (err) {
      showMessage('download_failed', {}, { emoji: '🚨' });
    }
  };

  const [remainingTime, setRemainingTime] = useState('Calculating...');

  const calculateRemainingTime = (expiryDate) => {
    const currentDate = new Date();
    const expiry = new Date(expiryDate);

    if (expiry > currentDate) {
      const timeDiff = expiry - currentDate;

      const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));

      if (days > 0) {
        return `${days} days remaining`;
      } else if (hours > 0) {
        return `${hours} hours remaining`;
      } else if (minutes > 0) {
        return `${minutes} minutes remaining`;
      } else {
        return 'Expired';
      }
    } else {
      return 'Expired';
    }
  };

  useEffect(() => {
    const expiryDate = vpn?.find((v) => v.payment_request === params.payment_request)?.order
      ?.expiry_date;

    if (expiryDate) {
      const interval = setInterval(() => {
        setRemainingTime(calculateRemainingTime(expiryDate));
      }, 1000);

      return () => clearInterval(interval); // Cleanup interval on component unmount
    } else {
      setRemainingTime('Not activated');
    }
  }, [vpn, params.payment_request]);

  const handleConnect = async () => {
    const configLines = vpn?.find((v) => v.payment_request === params.payment_request)?.order
      ?.WireguardConfig;
    if (!configLines) {
      Alert.alert('Configuration missing');
      return;
    }
    await initializeVpn();
    await connectVpn(parseWireGuardConfig(configLines));
    const status = await getVpnStatus();
    setVpnStatus(status);
  };

  const handleDisconnect = async () => {
    await disconnectVpn();
    const status = await getVpnStatus();
    setVpnStatus(status);
  };

  const handleStatus = async () => {
    const status = await getVpnStatus();
    setVpnStatus(status);
  };

  return (
    <Modal
      showClose
      title={`VPN plan`}
      children={
        <>
          <Section
            special={false}
            items={[
              {
                title: 'Location',
                value: (
                  <View
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: 'transparent',
                    }}>
                    <FlagIcon width={24} height={24} country={params.location} />
                    <Text
                      style={{
                        marginLeft: 4,
                        fontSize: 16,
                      }}>
                      {
                        lookup.byIso(
                          vpn?.find((v) => v.payment_request === params.payment_request).location
                        ).country
                      }
                    </Text>
                  </View>
                ),
              },
              {
                title: 'Payment Hash',
                value: truncateMiddle(
                  vpn?.find((v) => v.payment_request === params.payment_request)?.payment_hash,
                  5
                ),
              },
              {
                title: 'Payment Request',
                value: truncateMiddle(
                  vpn?.find((v) => v.payment_request === params.payment_request)?.payment_request,
                  5
                ),
              },
              {
                title: 'Duration',
                value: vpn?.find((v) => v.payment_request === params.payment_request)?.duration,
              },
              {
                title: 'Time Remaining',
                value: remainingTime,
              },
              ...(vpn?.find((v) => v.payment_request === params.payment_request)?.order?.expiry_date
                ? [
                    {
                      title: 'Valid until',
                      value: new Date(
                        vpn?.find(
                          (v) => v.payment_request === params.payment_request
                        )?.order?.expiry_date
                      ).toLocaleString(),
                    },
                  ]
                : []),
              {
                title: 'Provider',
                value: 'LNVPN',
              },
            ]}
          />
        </>
      }
      buttons={
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
              ...(new Date() <
              new Date(
                vpn?.find((v) => v.payment_request === params.payment_request)?.order?.expiry_date
              )
                ? [
                    {
                      text: 'Share',
                      icon: <ShareIcon />,
                      variant: 'secondary',
                      onPress: () => {
                        navigation.navigate('VpnShare', {
                          vpnCode: vpn
                            ?.find((v) => v.payment_request === params.payment_request)
                            ?.order?.WireguardConfig.join('\n'),
                          location: vpn?.find((v) => v.payment_request === params.payment_request)
                            .location,
                          config: vpn?.find((v) => v.payment_request === params.payment_request)
                            ?.order?.WireguardConfig,
                          hash: vpn?.find((v) => v.payment_request === params.payment_request)
                            ?.payment_hash,
                        });
                      },
                    },
                    {
                      text: 'Download',
                      variant: 'primary',
                      onPress: downloadAndShareVPN,
                    },
                  ]
                : []),
              // ...(new Date() <
              // new Date(
              //   vpn?.find((v) => v.payment_request === params.payment_request)?.order?.expiry_date
              // )
              //   ? [
              //       {
              //         text: 'Activate',
              //         variant: 'primary',
              //         disabled: remainingTime === 'Calculating...',
              //         onPress: activateVPN,
              //       },
              //     ]
              //   : []),
              ...(remainingTime === 'Not activated'
                ? [
                    {
                      text: 'Activate',
                      variant: 'primary',
                      onPress: activateVPN,
                    },
                  ]
                : []),
              ...(remainingTime !== 'Not activated'
                ? [
                    vpnStatus?.isConnected
                      ? {
                          text: 'Disconnect',
                          variant: 'primary',
                          onPress: handleDisconnect,
                        }
                      : {
                          text: 'Connect',
                          variant: 'primary',
                          onPress: handleConnect,
                        },
                    {
                      text: 'Status',
                      variant: 'secondary',
                      onPress: handleStatus,
                    },
                  ]
                : []),
            ]}
          />
        </View>
      }
    />
  );
}

export default withSheetProvider(ModalScreen);

const createStyles = (theme) =>
  StyleSheet.create({
    minus: {
      fontFamily: 'OverpassBold',
      fontSize: 32,
      color: '#9A4141',
      marginRight: 4,
    },
    plus: {
      fontFamily: 'OverpassBold',
      fontSize: 32,
      color: '#499A41',
      marginRight: 4,
    },
    container: {
      backgroundColor: greys(theme)[2300],
    },
    title: {
      fontSize: 20,
      fontWeight: 'bold',
      color: greys(theme)[1000],
    },
    separator: {
      marginVertical: 30,
      height: 1,
      width: '80%',
    },
  });
