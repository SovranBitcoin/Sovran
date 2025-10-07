import React, { useCallback, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useHandleCameraPermission } from 'hooks/useHandleCameraPermission';
import 'react-native-get-random-values';
import Swiper from 'react-native-web-infinite-swiper';
import { LinearGradient } from 'expo-linear-gradient';

import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon, { ArrowIcon } from 'assets/icons';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Haptics from 'components/ui/Haptics';

import { memoizedGetSelectedMint } from 'redux/cashu/selectors';
import { useMintManagement } from 'hooks/coco';
import { useTheme } from 'providers/ThemeProvider';
import { SheetManager } from 'react-native-actions-sheet';
import { Account } from './Account';
import { router } from 'expo-router';

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
  const { getPrimaryColor, getShadeColor } = useTheme();
  const { handlePermission } = useHandleCameraPermission();
  const { getBalances } = useMintManagement();

  const selectedMintUrl = useSelector(memoizedGetSelectedMint);

  // Use all accounts - don't filter based on balance data
  // The balance will be displayed as 0 if no data is available
  const loopedAccounts = accounts;

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

    router.push({
      pathname: `/${page}`,
      params: {
        to: 'ecashSendConfirmation',
        unit: accountUnit,
      },
    });
  };

  // Define action buttons
  const actionButtons: ActionButton[] = [
    {
      page: 'receive',
      text: {
        children: 'Receive',
      },
      icon: <ArrowIcon size={24} color={getPrimaryColor('0')} rotate={180} />,
    },
    {
      page: 'camera',
      text: {
        children: 'Scan',
      },
      icon: <Icon name="stash:qr-code" size={24} color={getPrimaryColor('0')} />,
    },
    {
      page: 'currency',
      text: {
        children: 'Send',
      },
      icon: <ArrowIcon size={24} color={getPrimaryColor('0')} rotate={0} />,
    },
  ];

  return (
    <>
      <View className="flex h-[350px] w-full">
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
            <VStack key={`${acc.unit}-${index}`} align="center" justify="center" className="flex-1">
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
                className={`flex-1 ${isReceive ? '-mr-3' : ''} ${isSend ? '-ml-3' : ''}`}
                style={
                  isCamera
                    ? {
                        maxWidth: 64,
                        zIndex: 10000,
                        shadowColor: getShadeColor('300'),
                        shadowOffset: { width: 0, height: 0 },
                        shadowOpacity: 0.75,
                        shadowRadius: 8,
                        elevation: 5,
                        borderRadius: 10000,
                        borderColor: getShadeColor('100'),
                        borderWidth: 0.5,
                      }
                    : { maxWidth: 'auto' }
                }
                onPress={() => handleButtonPress(page, account.unit)}>
                <LinearGradient
                  style={isCamera ? { padding: 8, borderRadius: 1000 } : undefined}
                  colors={
                    isCamera
                      ? [getShadeColor('100'), getShadeColor('300')]
                      : ['rgba(0,0,0,0)', 'rgba(0,0,0,0)']
                  }>
                  <VStack align="center" justify="center">
                    <HStack
                      blur={!isCamera}
                      align="center"
                      justify={isReceive ? 'flex-start' : isSend ? 'center' : 'center'}
                      className="w-full min-w-[90px] p-3"
                      style={{
                        ...(isCamera && { borderRadius: 1000 }),
                        ...(!isCamera && {
                          backgroundColor: getPrimaryColor('800'),
                          borderColor: getPrimaryColor('700'),
                        }),
                        ...(isReceive && {
                          borderBottomLeftRadius: 1000,
                          borderTopLeftRadius: 1000,
                        }),
                        ...(isSend && {
                          borderBottomRightRadius: 1000,
                          borderTopRightRadius: 1000,
                          paddingLeft: 0,
                        }),
                      }}>
                      {icon}
                      {!isCamera && (
                        <Text weight="bold" size={14} className="text-primary-0">
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
    </>
  );
}
