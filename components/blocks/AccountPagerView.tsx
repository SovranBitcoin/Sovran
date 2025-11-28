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
import { useProcessPaymentString } from 'hooks/coco/useProcessPaymentString';
import { useTheme } from 'providers/ThemeProvider';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { Account } from './Account';
import { router } from 'expo-router';

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

  const loopedAccounts = accounts;
  const swiperRef = useRef<any>(null);

  // Payment processing hook for clipboard paste
  const { processPaymentString } = useProcessPaymentString({
    unit: account.unit,
    selectedMint: selectedMintUrl,
    isFocused: true,
  });

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

  useReceive();

  // Handlers
  const handleReceive = useCallback(() => {
    router.navigate({
      pathname: '/(receive-flow)/receive',
      params: { to: 'sendToken', unit: account.unit },
    });
  }, [account.unit]);

  const handleScanQR = useCallback(async () => {
    const granted = await handlePermission();
    if (!granted) return;
    router.navigate({
      pathname: '/camera',
      params: { to: 'sendToken', unit: account.unit },
    });
  }, [handlePermission, account.unit]);

  const handleClipboardPaste = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) {
      Alert.alert('Clipboard Empty', 'No text found in clipboard.');
      return;
    }
    await processPaymentString({ data: text });
  }, [processPaymentString]);

  const handleSend = useCallback(async () => {
    let balance = 0;
    try {
      const balances = await getBalances();
      balance = balances[selectedMintUrl || ''] || 0;
    } catch (error) {
      if (__DEV__) console.error('Failed to get balance:', error);
    }

    if (balance <= 0) {
      router.navigate({
        pathname: '/(send-flow)/mintSelect',
        params: { to: 'sendToken', unit: account.unit },
      });
      return;
    }

    router.navigate({
      pathname: '/(send-flow)/currency',
      params: { to: 'sendToken', unit: account.unit },
    });
  }, [getBalances, selectedMintUrl, account.unit]);

  // Button components
  const ReceiveButton = () => {
    if (Platform.OS === 'ios') {
      return (
        <View style={{ flex: 1, zIndex: 1, position: 'absolute', left: 8 }}>
          <Host style={{ height: 48, width: 140 }} matchContents fixedSize>
            <ContextMenu activationMethod="longPress">
              <ContextMenu.Items>
                <SwiftUIButton systemImage="arrow.down.circle" onPress={handleReceive}>
                  Receive
                </SwiftUIButton>
              </ContextMenu.Items>
              <ContextMenu.Trigger>
                <SwiftUIButton
                  variant="glass"
                  modifiers={[frame({ height: 48, width: 140 }), cornerRadius(24)]}
                  onPress={handleReceive}>
                  <View
                    style={{
                      position: 'absolute',
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      width: 140 - 32 - 16,
                      height: 48 - 16,
                    }}>
                    <ArrowIcon size={20} color={primaryColor0} rotate={0} />
                    <Text>Receive</Text>
                  </View>
                </SwiftUIButton>
              </ContextMenu.Trigger>
            </ContextMenu>
          </Host>
        </View>
      );
    }

    return (
      <TouchableOpacity className="-mr-3 flex-1" onPress={handleReceive}>
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0)']}>
          <VStack align="center" justify="center">
            <HStack
              blur
              align="center"
              justify="flex-start"
              className="p-3"
              style={{
                backgroundColor: primaryColor800,
                borderColor: primaryColor700,
                borderBottomLeftRadius: 1000,
                borderTopLeftRadius: 1000,
              }}>
              <ArrowIcon size={24} color={primaryColor0} rotate={180} />
              <Text weight="bold" size={14} className="text-primary-0">
                Receive
              </Text>
            </HStack>
          </VStack>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  const ScanButton = () => {
    if (Platform.OS === 'ios') {
      return (
        <View style={{ maxWidth: 72, zIndex: 10000, position: 'absolute' }}>
          <Host style={{ height: 72, width: 72 }} matchContents fixedSize>
            <ContextMenu activationMethod="longPress">
              <ContextMenu.Items>
                <SwiftUIButton systemImage="qrcode.viewfinder" onPress={handleScanQR}>
                  Scan QR
                </SwiftUIButton>
                <SwiftUIButton systemImage="doc.on.clipboard" onPress={handleClipboardPaste}>
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
                  onPress={handleScanQR}>
                  <View
                    style={{
                      width: 48,
                      height: 56,
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

    return (
      <TouchableOpacity
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
            { text: 'Scan QR', onPress: handleScanQR },
            { text: 'Paste from Clipboard', onPress: handleClipboardPaste },
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
              <Icon name="stash:qr-code" size={24} color={primaryColor0} />
            </HStack>
          </VStack>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  const SendButton = () => {
    if (Platform.OS === 'ios') {
      return (
        <View style={{ flex: 1, zIndex: 4, position: 'absolute', right: 8 }}>
          <Host style={{ height: 48, width: 140 }} matchContents fixedSize>
            <ContextMenu activationMethod="longPress">
              <ContextMenu.Items>
                <SwiftUIButton systemImage="arrow.up.circle" onPress={handleSend}>
                  Send
                </SwiftUIButton>
              </ContextMenu.Items>
              <ContextMenu.Trigger>
                <SwiftUIButton
                  variant="glass"
                  modifiers={[frame({ height: 48, width: 140 }), cornerRadius(24)]}
                  onPress={handleReceive}>
                  <View
                    style={{
                      position: 'absolute',
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      width: 140 - 32,
                      height: 48 - 16,
                    }}>
                    <ArrowIcon size={20} color={primaryColor0} rotate={0} />
                    <Text>Send</Text>
                  </View>
                </SwiftUIButton>
              </ContextMenu.Trigger>
            </ContextMenu>
          </Host>
        </View>
      );
    }

    return (
      <TouchableOpacity className="-ml-3 flex-1" onPress={handleSend}>
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0)']}>
          <VStack align="center" justify="center">
            <HStack
              blur
              align="center"
              justify="center"
              className="w-full min-w-[90px] p-3"
              style={{
                backgroundColor: primaryColor800,
                borderColor: primaryColor700,
                borderBottomRightRadius: 1000,
                borderTopRightRadius: 1000,
                paddingLeft: 0,
              }}>
              <ArrowIcon size={24} color={primaryColor0} rotate={0} />
              <Text weight="bold" size={14} className="text-primary-0">
                Send
              </Text>
            </HStack>
          </VStack>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <View className="flex h-[350px] w-full">
        <Swiper
          containerStyle={{ height: 350 }}
          controlsEnabled={false}
          loop
          infinite
          from={0}
          ref={swiperRef}
          minDistanceForAction={0.1}
          onIndexChanged={onPageSelected}
          controlsProps={{ dotsTouchable: true, dotsPos: 'top' }}>
          {loopedAccounts.map((acc, index) => (
            <VStack key={`${acc.unit}-${index}`} align="center" justify="center" className="flex-1">
              <Account accounts={loopedAccounts} account={acc} goToIndex={goToIndex} />
            </VStack>
          ))}
        </Swiper>
      </View>

      <HStack
        justify="space-around"
        align="center"
        style={{ width: '100%', marginTop: -24, paddingBottom: 32, zIndex: 10 }}>
        <ReceiveButton />
        <ScanButton />
        <SendButton />
      </HStack>
    </>
  );
}
