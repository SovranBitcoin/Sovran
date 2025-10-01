import React, { useCallback, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useHandleCameraPermission } from 'hooks/useHandleCameraPermission';
import 'react-native-get-random-values';
import { StyleSheet } from 'react-native';
import Swiper from 'react-native-web-infinite-swiper';
import { LinearGradient } from 'expo-linear-gradient';

import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon, { ArrowIcon } from 'assets/icons';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Haptics from 'components/ui/Haptics';

import { memoizedGetSelectedMint } from 'helper/redux/cashu/selectors';
import { useMintManagement } from 'hooks/coco';
import { greys, Theme } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { SheetManager } from 'react-native-actions-sheet';
import { Account } from './Account';
import { useTypedNavigation } from 'helper/navigation';

interface ActionButton {
  page: 'receive' | 'camera' | 'currency';
  text: {
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
  const { getBalances } = useMintManagement();

  const styles = createStyles(theme);
  const navigation = useTypedNavigation();

  const selectedMintUrl = useSelector(memoizedGetSelectedMint);
  const [multipleBalances, setMultipleBalances] = React.useState<any[]>([]);

  // Load balances from Coco
  React.useEffect(() => {
    const loadBalances = async () => {
      try {
        const balances = await getBalances();
        const balanceArray = Object.entries(balances).map(([mintUrl, amount]) => ({
          mintUrl,
          amount,
          unit: 'SAT', // Coco returns amounts in sats
        }));
        setMultipleBalances(balanceArray);
      } catch (error) {
        console.error('Failed to load balances:', error);
        setMultipleBalances([]);
      }
    };
    loadBalances();
  }, [getBalances]);

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

  useEffect(() => {
    goToIndex(accounts.findIndex((a) => a.unit === account.unit));
  }, [accounts, account]);

  const handleButtonPress = async (page: string, accountUnit: string) => {
    // Get balance from Coco
    let balance = 0;
    try {
      const balances = await getBalances();
      balance = balances[selectedMintUrl || ''] || 0;
    } catch (error) {
      console.error('Failed to get balance:', error);
      balance = 0;
    }

    if (page === 'currency' && balance <= 0) {
      SheetManager.show('mint-balance', {
        payload: {
          navigate: true,
          requireBalance: true,
        },
        onClose: (mint?: { id: string; unit: string }) => {
          if (mint?.id) {
            const idx = accounts.findIndex((a) => a.unit === mint.unit.toLowerCase());
            if (idx !== -1) {
              setAccount(accounts[idx]);
            }
          }
        },
      });
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
    });
  };

  // Define action buttons
  const actionButtons: ActionButton[] = [
    {
      page: 'receive',
      text: {
        children: 'Receive',
      },
      icon: <ArrowIcon size={24} color={greys(theme)[0]} rotate={180} />,
    },
    {
      page: 'camera',
      text: {
        children: 'Scan',
      },
      icon: (
        <Icon
          name="stash:qr-code"
          size={24}
          color={theme.id === 'light' ? greys(theme)[950] : greys(theme)[0]}
        />
      ),
    },
    {
      page: 'currency',
      text: {
        children: 'Send',
      },
      icon: <ArrowIcon size={24} color={greys(theme)[0]} rotate={0} />,
    },
  ];

  return (
    <View>
      <View className={`flex h-[350px] w-full`}>
        <Swiper
          containerStyle={{
            height: 350,
          }}
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
            <VStack
              key={`${acc.unit}-${index}`}
              align="center"
              justify="center"
              style={{
                flex: 1,
              }}>
              <Account accounts={loopedAccounts} account={acc} goToIndex={goToIndex} />
            </VStack>
          ))}
        </Swiper>
      </View>
      <HStack
        justify="space-around"
        style={{
          position: 'absolute',
          width: '100%',
          padding: 0,
          margin: 0,
          marginTop: 350,
          height: 0,
          paddingLeft: 16,
          paddingRight: 16,
        }}>
        <HStack align="center" justify="space-around" className="absolute bottom-0 w-full">
          {actionButtons.map(({ page, text, icon }) => {
            const isCamera = page === 'camera';
            const isReceive = page === 'receive';
            const isSend = page === 'currency';

            return (
              <TouchableOpacity
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
                  colors={
                    isCamera
                      ? [theme.shades[100], theme.shades[300]]
                      : ['rgba(0,0,0,0)', 'rgba(0,0,0,0)']
                  }>
                  <VStack align="center" justify="center">
                    <HStack
                      style={[
                        styles.iconView,
                        isCamera && styles.cameraIconView,
                        isReceive && styles.receiveIconView,
                        isSend && styles.sendIconView,
                      ]}
                      blur={!isCamera}
                      align="center"
                      justify="center">
                      <View>{icon}</View>
                      {!isCamera && (
                        <Text weight="bold" size={14} style={{ color: greys(theme)[0] }}>
                          {text.children}
                        </Text>
                      )}
                    </HStack>
                  </VStack>
                </LinearGradient>
              </TouchableOpacity>
            );
          })}
        </HStack>
      </HStack>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    touchableOpacity: {
      flex: 1,
      maxWidth: 'auto',
    },
    cameraButton: {
      maxWidth: 64,
      zIndex: 10000,
      shadowColor: theme.shades[300],
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.75,
      shadowRadius: 8,
      elevation: 5,
      borderRadius: 10000,
      borderColor: theme.shades[100],
      borderWidth: 0.5,
    },
    receiveButton: {
      marginRight: -12,
    },
    sendButton: {
      marginLeft: -12,
    },
    cameraGradient: {
      padding: 8,
      borderRadius: 1000,
    },
    iconView: {
      alignContent: 'center',
      padding: 12,
      minWidth: 90,
      width: '100%',
    },
    cameraIconView: {
      borderRadius: 1000,
    },
    receiveIconView: {
      backgroundColor: greys(theme)[800],
      borderBottomLeftRadius: 1000,
      borderTopLeftRadius: 1000,
      borderColor: greys(theme)[700],
    },
    sendIconView: {
      backgroundColor: greys(theme)[800],
      borderBottomRightRadius: 1000,
      borderTopRightRadius: 1000,
      borderColor: greys(theme)[700],
    },
  });
