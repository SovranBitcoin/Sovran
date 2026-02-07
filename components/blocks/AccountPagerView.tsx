import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import { useHandleCameraPermission } from 'hooks/useHandleCameraPermission';
import 'react-native-get-random-values';
import Swiper from 'react-native-web-infinite-swiper';
import { LinearGradient } from 'expo-linear-gradient';
import { useWindowDimensions } from 'react-native';
import { supportsLiquidGlass } from 'helper/version';
import {
  Host,
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  padding,
} from '@expo/ui/swift-ui/modifiers';

import { VStack } from 'components/ui/View/VStack';
import { View } from 'components/ui/View/View';
import Icon from 'assets/icons';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { EnhancedHaptics } from 'components/ui/Haptics';
import { Button } from 'components/ui/Button';

import { useMintStore } from 'stores/mintStore';
import { useTheme } from 'providers/ThemeProvider';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { Account } from './Account';
import { router } from 'expo-router';
import { useMintManagement } from '@/hooks/coco/useMintManagement';

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
  const { height: windowHeight } = useWindowDimensions();
  const { getPrimaryColor, getShadeColor } = useTheme();
  const shadeColor100 = useMemo(() => getShadeColor('100'), [getShadeColor]);
  const shadeColor300 = useMemo(() => getShadeColor('300'), [getShadeColor]);

  // Calculate 50% of screen height for the pager view
  const pagerHeight = Math.max(windowHeight * 0.3, 250);

  const { handlePermission } = useHandleCameraPermission();
  const { getBalances } = useMintManagement();

  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMintUrl = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

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

  // Button components (2-column row + centered overlay)
  const BUTTON_H = 48;
  const QR_SIZE = 72;
  // Keep Send/Receive foreground neutral; reserve accent tint for the QR background only.
  const liquidGlassForeground = useMemo(() => getPrimaryColor('0'), [getPrimaryColor]);
  const qrGlassTint = useMemo(() => getShadeColor('300'), [getShadeColor]);

  function LiquidCapsuleButton({
    label,
    systemIcon,
    onPress,
  }: {
    label: string;
    systemIcon: React.ComponentProps<typeof SwiftUIImage>['systemName'];
    onPress: () => void;
  }) {
    return (
      <Host style={{ height: BUTTON_H, width: '100%' }} matchContents={false}>
        <SwiftUIButton
          modifiers={[
            buttonStyle('glass'),
            frame({ height: BUTTON_H, maxWidth: Infinity, alignment: 'center' }),
          ]}
          onPress={onPress}>
          <SwiftUIHStack
            alignment="center"
            spacing={8}
            modifiers={[frame({ maxWidth: Infinity, alignment: 'center' })]}>
            <SwiftUIImage systemName={systemIcon} size={18} color={liquidGlassForeground} />
            <SwiftUIText
              modifiers={[
                font({ size: 14, weight: 'bold' }),
                foregroundStyle(liquidGlassForeground),
                padding({ vertical: 8 }),
              ]}>
              {label}
            </SwiftUIText>
          </SwiftUIHStack>
        </SwiftUIButton>
      </Host>
    );
  }

  function LiquidQRButton({ onPress }: { onPress: () => void }) {
    return (
      <Host style={{ height: QR_SIZE, width: QR_SIZE }} matchContents={false}>
        <SwiftUIButton
          modifiers={[
            buttonStyle('glass'),
            frame({ height: QR_SIZE, width: QR_SIZE }),
            glassEffect({
              shape: 'circle',
              glass: {
                tint: qrGlassTint, // 👈 background tint (only for QR)
                variant: 'regular', // subtle / material-like
                interactive: true, // reacts to presses
              },
            }),
          ]}
          onPress={onPress}>
          <SwiftUIHStack
            alignment="center"
            modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' })]}>
            <SwiftUIImage systemName="qrcode.viewfinder" size={22} color={liquidGlassForeground} />
          </SwiftUIHStack>
        </SwiftUIButton>
      </Host>
    );
  }

  return (
    <>
      <View style={{ height: pagerHeight, width: '100%' }}>
        <Swiper
          containerStyle={{ height: pagerHeight }}
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
              <Account
                accounts={loopedAccounts}
                account={acc}
                goToIndex={goToIndex}
                pagerHeight={pagerHeight}
              />
            </VStack>
          ))}
        </Swiper>
      </View>

      <View
        style={{
          width: '100%',
          paddingHorizontal: 12,
          marginTop: 8,
          position: 'relative',
          height: Math.max(QR_SIZE, BUTTON_H),
          justifyContent: 'center',
        }}>
        {/* Two equal columns (capsules) */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            {supportsLiquidGlass() ? (
              <LiquidCapsuleButton
                label="Receive"
                systemIcon="arrow.down.left"
                onPress={handleReceive}
              />
            ) : (
              <Button
                text="Receive"
                icon={<Icon name="lucide:arrow-down-left" size={16} color={getPrimaryColor('0')} />}
                onPress={handleReceive}
                variant="secondary"
                blur={{ intensity: 70, tint: 'dark' }}
                haptics
                style={{
                  margin: 0,
                  marginBottom: 0,
                  width: '100%',
                  minHeight: BUTTON_H,
                }}
              />
            )}
          </View>

          <View style={{ flex: 1 }}>
            {supportsLiquidGlass() ? (
              <LiquidCapsuleButton label="Send" systemIcon="arrow.up.right" onPress={handleSend} />
            ) : (
              <Button
                text="Send"
                icon={<Icon name="lucide:arrow-up-right" size={16} color={getPrimaryColor('0')} />}
                onPress={handleSend}
                variant="secondary"
                blur={{ intensity: 70, tint: 'dark' }}
                haptics
                style={{
                  margin: 0,
                  marginBottom: 0,
                  width: '100%',
                  minHeight: BUTTON_H,
                }}
              />
            )}
          </View>
        </View>

        {/* Overlay QR in the center */}
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            alignItems: 'center',
            zIndex: 1000,
          }}>
          {supportsLiquidGlass() ? (
            <LiquidQRButton onPress={handleScanQR} />
          ) : (
            <TouchableOpacity
              style={{
                width: QR_SIZE,
                height: QR_SIZE,
                shadowColor: shadeColor300,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.75,
                shadowRadius: 8,
                elevation: 5,
                borderRadius: 10000,
                borderColor: shadeColor100,
                borderWidth: 0.5,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              haptics={{ type: 'impact', impactStyle: 'light' }}
              activeOpacity={0.75}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={handleScanQR}>
              <LinearGradient
                style={{
                  padding: 8,
                  borderRadius: 1000,
                  width: '100%',
                  height: '100%',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                colors={[shadeColor100, shadeColor300]}>
                <Icon name="stash:qr-code" size={24} color={getPrimaryColor('0')} />
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </>
  );
}
