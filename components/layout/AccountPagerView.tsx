import React, { useCallback, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useNavigation } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import 'react-native-get-random-values';
import { Platform, StyleSheet } from 'react-native';
import Swiper from 'react-native-web-infinite-swiper';
import { LinearGradient } from 'expo-linear-gradient';

import { Text, View } from 'components/common/Themed';
import Icon, { ArrowIcon } from 'assets/icons';

import { TouchableOpacity } from 'components/common/TouchableOpacity';
import Haptics from 'components/common/Haptics';

import {
  memoizedGetAllBalancesMultipleCurrencies,
  memoizedGetBalance,
  memoizedGetSelectedMint,
  useCashu,
} from 'helper/redux/cashu';
import { greys, shades } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { store } from 'helper/redux/store';
import { showMessage } from 'helper/popup/popups';
import { Account } from './Account';

export function AccountPagerView({ accounts, setAccount, account }) {
  const { proofs, keysets } = useCashu();

  const [hasPermission, requestPermission] = useCameraPermissions();
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const navigation = useNavigation();

  const selectedMintUrl = useSelector(memoizedGetSelectedMint);
  const multipleBalances = useSelector(memoizedGetAllBalancesMultipleCurrencies);
  const loopedAccounts = accounts.filter((account) => {
    return multipleBalances.some(
      (balance) => balance.unit === account.unit && balance.mintUrl === selectedMintUrl
    );
  });

  const swiperRef = useRef(null);

  const onPageSelected = useCallback(
    (index) => {
      const position = index;
      setAccount(accounts[position]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [accounts]
  );

  function goToIndex(index) {
    swiperRef.current.goTo(index);
  }

  return (
    <View style={styles.transparentBackground}>
      <View style={styles.accountPagerView}>
        <Swiper
          controlsEnabled={false}
          loop
          infinite
          from={0}
          ref={swiperRef}
          minDistanceForAction={0.1}
          onIndexChanged={onPageSelected}
          controlsProps={{
            dotsTouchable: true,
            dotsPos: 'top',
          }}>
          {loopedAccounts.map((acc, index) => (
            <View key={acc.key + index} style={styles.swiperView}>
              <Account
                accounts={loopedAccounts}
                account={acc}
                proofs={proofs}
                keysets={keysets}
                goToIndex={goToIndex}
              />
            </View>
          ))}
        </Swiper>
      </View>
      <View style={styles.absoluteTop}>
        {[
          {
            page: 'receive',
            text: {
              id: 'onchain_receive_button',
              children: 'Receive',
            },
            icon: <ArrowIcon size={24} color={greys(theme)[0]} rotate={180} />,
          },
          {
            page: 'camera',
            text: {
              id: 'scan_button',
              children: 'Scan',
            },
            icon: <Icon name="stash:qr-code" size={24} color={greys(theme)[0]} />,
          },
          {
            page: 'currency',
            text: {
              id: 'onchain_send_button',
              children: 'Send',
            },
            icon: <ArrowIcon size={24} color={greys(theme)[0]} rotate={0} />,
          },
        ].map(({ page, text, icon }) => {
          return (
            <TouchableOpacity
              key={page}
              style={[
                styles.touchableOpacity,
                page === 'camera' && styles.cameraButton,
                page === 'receive' && styles.receiveButton,
                page === 'currency' && styles.sendButton,
              ]}
              onPress={async () => {
                const balance = memoizedGetBalance(account.unit)(store.getState());
                if (page === 'currency' && balance <= 0) {
                  showMessage(
                    'insufficient_balance',
                    {
                      amount: balance,
                      unit: account.unit,
                      fee: 0,
                    },
                    { emoji: '🚨' }
                  );
                } else {
                  if (page === 'camera' && !hasPermission?.granted) {
                    const res = await requestPermission();
                    if (!res.granted) {
                      showMessage('camera_permission_denied', {}, { emoji: '🚨' });
                      return;
                    }
                  }
                  navigation.navigate(page, {
                    to: 'ecashSendConfirmation',
                    unit: account.unit,
                    type: account.type,
                    accountIndex: account.accountIndex,
                  });
                }
              }}>
              <LinearGradient
                style={[page === 'camera' && styles.cameraGradient]}
                colors={
                  page === 'camera'
                    ? [shades[200], shades[400]]
                    : ['rgba(0,0,0,0)', 'rgba(0,0,0,0)']
                }>
                <View style={styles.iconContainer}>
                  <View
                    style={[
                      styles.iconView,
                      page === 'camera' && styles.cameraIconView,
                      page === 'receive' && styles.receiveIconView,
                      page === 'currency' && styles.sendIconView,
                    ]}>
                    <View style={styles.transparentBackground}>{icon}</View>
                    {page !== 'camera' && (
                      <Text weight="bold" size={14} style={styles.iconText}>
                        {text.children}
                      </Text>
                    )}
                  </View>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    transparentBackground: {
      backgroundColor: 'transparent',
    },
    accountPagerView: {
      display: 'flex',
      height: 300,
      width: '100%',
    },
    swiperView: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: greys(theme)[2300],
    },
    absoluteTop: {
      position: 'absolute',
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      top: Platform.OS === 'web' ? 159 + 64 : 159,
      padding: 0,
      margin: 0,
      zIndex: 3,
      height: 130,
      backgroundColor: 'transparent',
      paddingLeft: 16,
      paddingRight: 16,
    },
    touchableOpacity: {
      flex: 1,
      maxWidth: 'auto',
      zIndex: -1,
      backgroundColor: 'transparent',
    },
    cameraButton: {
      maxWidth: 64,
      zIndex: 10000,
      shadowColor: shades[200],
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.75,
      shadowRadius: 8,
      elevation: 5,
      borderRadius: 10000,
      borderColor: shades[200],
      borderWidth: 0.5,
    },
    receiveButton: {
      marginRight: -8,
    },
    sendButton: {
      marginLeft: -8,
    },
    cameraGradient: {
      padding: 8,
      borderRadius: 1000,
    },
    iconContainer: {
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    iconView: {
      alignContent: 'center',
      flexDirection: 'row',
      padding: 12,
      minWidth: 90,
      width: '100%',
      justifyContent: 'center',
      alignItems: 'center',
    },
    cameraIconView: {
      backgroundColor: 'transparent',
      borderRadius: 1000,
    },
    receiveIconView: {
      backgroundColor: greys(theme)[1800],
      borderBottomLeftRadius: 1000,
      borderTopLeftRadius: 1000,
      borderWidth: 0.5,
      borderColor: greys(theme)[1400],
    },
    sendIconView: {
      backgroundColor: greys(theme)[1800],
      borderBottomRightRadius: 1000,
      borderTopRightRadius: 1000,
      borderWidth: 0.5,
      borderColor: greys(theme)[1400],
    },
    iconText: {
      color: greys(theme)[0],
    },
  });
