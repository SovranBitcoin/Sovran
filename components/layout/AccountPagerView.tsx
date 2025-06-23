import React, { useCallback, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useHandleCameraPermission } from 'helper/hooks/useHandleCameraPermission';
import 'react-native-get-random-values';
import { Platform, StyleSheet } from 'react-native';
import Swiper from 'react-native-web-infinite-swiper';
import { LinearGradient } from 'expo-linear-gradient';

import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import Icon, { ArrowIcon } from 'assets/icons';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import Haptics from 'components/common/Haptics';

import {
  memoizedGetAllBalancesMultipleCurrencies,
  memoizedGetBalance,
  memoizedGetSelectedMint,
} from 'helper/redux/cashu';
import { greys, shades } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { store } from 'helper/redux/store';
import { showMessage } from 'helper/popup/popups';
import { Account } from './Account';
import { useTypedNavigation } from 'helper/navigation';

interface ActionButton {
  page: 'receive' | 'camera' | 'currency';
  text: {
    id: string;
    children: string;
  };
  icon: React.ReactNode;
}

interface AccountType {
  unit: string;
}

interface AccountPagerViewProps {
  accounts: AccountType[];
  setAccount: (account: AccountType) => void;
  account: AccountType;
}

export function AccountPagerView({
  accounts,
  setAccount,
  account,
}: AccountPagerViewProps): React.ReactElement {
  const { handlePermission } = useHandleCameraPermission();
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useTypedNavigation();

  const selectedMintUrl = useSelector(memoizedGetSelectedMint);
  const multipleBalances = useSelector(memoizedGetAllBalancesMultipleCurrencies);

  // Filter accounts that have a matching balance entry
  const loopedAccounts = accounts.filter((acc) =>
    multipleBalances.some(
      (balance: any) => balance.unit === acc.unit && balance.mintUrl === selectedMintUrl
    )
  );

  const swiperRef = useRef<any>(null);

  const onPageSelected = useCallback(
    (index: number): void => {
      setAccount(accounts[index]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [accounts, setAccount]
  );

  const goToIndex = (index: number): void => {
    swiperRef.current?.goTo(index);
  };

  const handleButtonPress = async (page: string, accountUnit: string) => {
    const balance = memoizedGetBalance(accountUnit)(store.getState());

    if (page === 'currency' && balance <= 0) {
      showMessage(
        'insufficient_balance',
        {
          amount: balance,
          unit: accountUnit,
          fee: 0,
        },
        { emoji: '🚨' }
      );
      return;
    }

    if (page === 'camera') {
      const granted = await handlePermission();
      if (!granted) {
        return;
      }
    }

    navigation.navigate(page, {
      to: 'ecashSendConfirmation',
      unit: accountUnit,
      type: account.type,
      accountIndex: account.accountIndex,
    });
  };

  // Define action buttons
  const actionButtons: ActionButton[] = [
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
      icon: (
        <Icon
          name="stash:qr-code"
          size={24}
          color={theme === 'light' ? greys(theme)[2300] : greys(theme)[0]}
        />
      ),
    },
    {
      page: 'currency',
      text: {
        id: 'onchain_send_button',
        children: 'Send',
      },
      icon: <ArrowIcon size={24} color={greys(theme)[0]} rotate={0} />,
    },
  ];

  return (
    <View className="bg-transparent">
      <View className="flex h-[300px] w-full">
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
            <View
              key={`${acc.key}-${index}`}
              style={{
                flex: 1,
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: greys(theme)[2300],
              }}>
              <Account accounts={loopedAccounts} account={acc} goToIndex={goToIndex} />
            </View>
          ))}
        </Swiper>
      </View>
      <View
        style={{
          position: 'absolute',
          width: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-around',
          top: Platform.OS === 'web' ? 223 : 159,
          padding: 0,
          margin: 0,
          zIndex: 3,
          height: 130,
          backgroundColor: 'transparent',
          paddingLeft: 16,
          paddingRight: 16,
        }}>
        {actionButtons.map(({ page, text, icon }) => {
          const isCamera = page === 'camera';
          const isReceive = page === 'receive';
          const isSend = page === 'currency';

          return (
            <TouchableOpacity
              testID={text.children.toLowerCase()}
              key={page}
              style={[
                styles.touchableOpacity,
                isCamera && styles.cameraButton,
                isReceive && styles.receiveButton,
                isSend && styles.sendButton,
              ]}
              onPress={() => handleButtonPress(page, account.unit)}>
              <LinearGradient
                style={[isCamera && styles.cameraGradient]}
                colors={isCamera ? [shades[200], shades[400]] : ['rgba(0,0,0,0)', 'rgba(0,0,0,0)']}>
                <View style={styles.iconContainer}>
                  <View
                    style={[
                      styles.iconView,
                      isCamera && styles.cameraIconView,
                      isReceive && styles.receiveIconView,
                      isSend && styles.sendIconView,
                    ]}>
                    <View className="bg-transparent">{icon}</View>
                    {!isCamera && (
                      <Text weight="bold" size={14} style={{ color: greys(theme)[0] }}>
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

const createStyles = (theme: string) =>
  StyleSheet.create({
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
      borderWidth: 0.3,
      borderColor: greys(theme)[1500],
    },
    sendIconView: {
      backgroundColor: greys(theme)[1800],
      borderBottomRightRadius: 1000,
      borderTopRightRadius: 1000,
      borderWidth: 0.3,
      borderColor: greys(theme)[1500],
    },
  });
