import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import { useHandleCameraPermission } from 'hooks/useHandleCameraPermission';
import 'react-native-get-random-values';
import Swiper from 'react-native-web-infinite-swiper';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Host, Button as SwiftUIButton, ContextMenu } from '@expo/ui/swift-ui';
import { frame, cornerRadius, background } from '@expo/ui/swift-ui/modifiers';

import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon, { ArrowIcon } from 'assets/icons';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { EnhancedHaptics } from 'components/ui/Haptics';

import { useMintStore } from 'stores/mintStore';
import { useMintManagement, useReceive } from 'hooks/coco';
import { useTheme } from 'providers/ThemeProvider';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
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
  const primaryColor0 = useMemo(() => getPrimaryColor('0'), [getPrimaryColor]);
  const primaryColor700 = useMemo(() => getPrimaryColor('700'), [getPrimaryColor]);
  const primaryColor800 = useMemo(() => getPrimaryColor('800'), [getPrimaryColor]);
  const shadeColor100 = useMemo(() => getShadeColor('100'), [getShadeColor]);
  const shadeColor300 = useMemo(() => getShadeColor('300'), [getShadeColor]);

  const { handlePermission } = useHandleCameraPermission();
  const { getBalances } = useMintManagement();

  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMintUrl = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  // Use all accounts - don't filter based on balance data
  // The balance will be displayed as 0 if no data is available
  const loopedAccounts = accounts;

  const swiperRef = useRef<any>(null);

  const onPageSelected = useCallback(
    async (index: number): Promise<void> => {
      setAccount(accounts[index]);
      await EnhancedHaptics.successHaptic();
    },
    [accounts, setAccount]
  );

  const goToIndex = (index: number): void => {
    swiperRef.current?.goTo(index);
  };

  useEffect(() => {
    goToIndex(accounts.findIndex((a) => a.unit === account.unit));
  }, [accounts, account]);

  const handleButtonPress = useCallback(
    async (page: string, accountUnit: string) => {
      // Get balance from Coco
      let balance = 0;
      try {
        const balances = await getBalances();
        balance = balances[selectedMintUrl || ''] || 0;
      } catch (error) {
        if (__DEV__) {
          console.error('Failed to get balance:', error);
        }
        balance = 0;
      }

      // If no balance on selected mint, go to mint selection first
      if (page === 'currency' && balance <= 0) {
        router.navigate({
          pathname: '/(send-flow)/mintSelect',
          params: {
            to: 'sendToken',
            unit: accountUnit,
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

      // Use modal groups for nested navigation behavior
      let pathname: string;
      if (page === 'receive') {
        pathname = '/(receive-flow)/receive';
      } else if (page === 'currency') {
        pathname = '/(send-flow)/currency';
      } else {
        pathname = `/${page}`;
      }

      router.navigate({
        pathname: pathname as any,
        params: {
          to: 'sendToken',
          unit: accountUnit,
        },
      });
    },
    [getBalances, selectedMintUrl, handlePermission]
  );

  useReceive();

  // Handler for scanning QR code via camera
  const handleScanQR = useCallback(
    async (accountUnit: string) => {
      const granted = await handlePermission();
      if (!granted) {
        return;
      }
      router.navigate({
        pathname: '/camera',
        params: {
          to: 'sendToken',
          unit: accountUnit,
        },
      });
    },
    [handlePermission]
  );

  // Handler for pasting from clipboard
  const handleClipboardPaste = useCallback(async (accountUnit: string) => {
    const text = await Clipboard.getStringAsync();
    if (!text) {
      Alert.alert('Clipboard Empty', 'No text found in clipboard.');
      return;
    }
    // Navigate to camera screen with clipboard data as initial value
    router.navigate({
      pathname: '/camera' as any,
      params: {
        to: 'sendToken',
        unit: accountUnit,
        clipboardData: text,
      },
    });
  }, []);

  // Define action buttons - memoized to prevent recreation on every render
  const actionButtons: ActionButton[] = useMemo(
    () => [
      {
        page: 'receive' as const,
        text: {
          children: 'Receive',
        },
        icon: <ArrowIcon size={24} color={primaryColor0} rotate={180} />,
      },
      {
        page: 'camera' as const,
        text: {
          children: 'Scan',
        },
        icon: <Icon name="stash:qr-code" size={24} color={primaryColor0} />,
      },
      {
        page: 'currency' as const,
        text: {
          children: 'Send',
        },
        icon: <ArrowIcon size={24} color={primaryColor0} rotate={0} />,
      },
    ],
    [primaryColor0]
  );

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

            // Render receive button with ContextMenu on iOS
            if (isReceive && Platform.OS === 'ios') {
              return (
                <View key={page} style={{ flex: 1, marginRight: -12, zIndex: 1 }}>
                  <Host style={{ height: 48, width: 130 }} matchContents fixedSize={true}>
                    <ContextMenu activationMethod="longPress">
                      <ContextMenu.Items>
                        <SwiftUIButton
                          systemImage="arrow.down.circle"
                          onPress={() => handleButtonPress(page, account.unit)}>
                          Receive
                        </SwiftUIButton>
                      </ContextMenu.Items>
                      <ContextMenu.Trigger>
                        <SwiftUIButton
                          variant="glass"
                          modifiers={[frame({ height: 48, width: 140 }), cornerRadius(24)]}
                          onPress={() => handleButtonPress(page, account.unit)}>
                          <View
                            style={{
                              width: 80,
                              height: 36,
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 6,
                            }}>
                            <ArrowIcon size={20} color={primaryColor0} rotate={180} />
                            <Text weight="bold" size={14} style={{ color: primaryColor0 }}>
                              Receive
                            </Text>
                          </View>
                        </SwiftUIButton>
                      </ContextMenu.Trigger>
                    </ContextMenu>
                  </Host>
                </View>
              );
            }

            // Render camera button with ContextMenu on iOS
            if (isCamera && Platform.OS === 'ios') {
              return (
                <View key={page} style={{ maxWidth: 72, zIndex: 10000 }}>
                  <Host style={{ height: 72, width: 72 }} matchContents fixedSize={true}>
                    <ContextMenu activationMethod="longPress">
                      <ContextMenu.Items>
                        <SwiftUIButton
                          systemImage="qrcode.viewfinder"
                          onPress={() => handleScanQR(account.unit)}>
                          Scan QR
                        </SwiftUIButton>
                        <SwiftUIButton
                          systemImage="doc.on.clipboard"
                          onPress={() => handleClipboardPaste(account.unit)}>
                          Paste from Clipboard
                        </SwiftUIButton>
                      </ContextMenu.Items>
                      <ContextMenu.Trigger>
                        <SwiftUIButton
                          variant="glass"
                          modifiers={[
                            frame({ height: 72, width: 72 }),
                            background(getShadeColor('300')),
                            cornerRadius(36),
                          ]}
                          onPress={() => handleScanQR(account.unit)}>
                          <View
                            style={{
                              width: 48,
                              height: 48 + 8,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}>
                            <Icon name="stash:qr-code" size={28} color={primaryColor0} />
                          </View>
                        </SwiftUIButton>
                      </ContextMenu.Trigger>
                    </ContextMenu>
                  </Host>
                </View>
              );
            }

            // Render send button with ContextMenu on iOS
            if (isSend && Platform.OS === 'ios') {
              return (
                <View key={page} style={{ flex: 1, marginLeft: -24, zIndex: 1 }}>
                  <Host style={{ height: 48, width: 130 }} matchContents fixedSize={true}>
                    <ContextMenu activationMethod="longPress">
                      <ContextMenu.Items>
                        <SwiftUIButton
                          systemImage="arrow.up.circle"
                          onPress={() => handleButtonPress(page, account.unit)}>
                          Send
                        </SwiftUIButton>
                      </ContextMenu.Items>
                      <ContextMenu.Trigger>
                        <SwiftUIButton
                          variant="glass"
                          modifiers={[frame({ height: 48, width: 130 }), cornerRadius(24)]}
                          onPress={() => handleButtonPress(page, account.unit)}>
                          <View
                            style={{
                              width: 100,
                              height: 36,
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 6,
                            }}>
                            <ArrowIcon size={20} color={primaryColor0} rotate={0} />
                            <Text weight="bold" size={14} style={{ color: primaryColor0 }}>
                              Send
                            </Text>
                          </View>
                        </SwiftUIButton>
                      </ContextMenu.Trigger>
                    </ContextMenu>
                  </Host>
                </View>
              );
            }

            // Render camera button with Alert menu on Android
            if (isCamera && Platform.OS === 'android') {
              return (
                <TouchableOpacity
                  key={page}
                  style={{
                    maxWidth: 64,
                    zIndex: 10000,
                    shadowColor: shadeColor300,
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.75,
                    shadowRadius: 8,
                    elevation: 5,
                    borderRadius: 10000,
                    borderColor: shadeColor100,
                    borderWidth: 0.5,
                  }}
                  onPress={() => {
                    Alert.alert('Scan Options', 'Choose how to scan', [
                      {
                        text: 'Scan QR',
                        onPress: () => handleScanQR(account.unit),
                      },
                      {
                        text: 'Paste from Clipboard',
                        onPress: () => handleClipboardPaste(account.unit),
                      },
                      { text: 'Cancel', style: 'cancel' },
                    ]);
                  }}>
                  <LinearGradient
                    style={{ padding: 8, borderRadius: 1000 }}
                    colors={[shadeColor100, shadeColor300]}>
                    <VStack align="center" justify="center">
                      <HStack
                        align="center"
                        justify="center"
                        className="w-full min-w-[90px] p-3"
                        style={{ borderRadius: 1000 }}>
                        {icon}
                      </HStack>
                    </VStack>
                  </LinearGradient>
                </TouchableOpacity>
              );
            }

            // Render receive and send buttons on Android (fallback)
            return (
              <TouchableOpacity
                key={page}
                className={`flex-1 ${isReceive ? '-mr-3' : ''} ${isSend ? '-ml-3' : ''}`}
                style={{ maxWidth: 'auto' }}
                onPress={() => handleButtonPress(page, account.unit)}>
                <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0)']}>
                  <VStack align="center" justify="center">
                    <HStack
                      blur
                      align="center"
                      justify={isReceive ? 'flex-start' : 'center'}
                      className="w-full min-w-[90px] p-3"
                      style={{
                        backgroundColor: primaryColor800,
                        borderColor: primaryColor700,
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
                      <Text weight="bold" size={14} className="text-primary-0">
                        {text.children}
                      </Text>
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
