import React, { useCallback, useEffect, useRef } from 'react';
import { useHandleCameraPermission } from 'hooks/useHandleCameraPermission';
import 'react-native-get-random-values';
import Swiper from 'react-native-web-infinite-swiper';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, useWindowDimensions } from 'react-native';
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
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { EnhancedHaptics } from 'components/ui/Haptics';
import { Button } from 'components/ui/Button';

import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { Account } from './Account';
import { router } from 'expo-router';
import { useMintManagement } from '@/hooks/coco/useMintManagement';
import { LiquidButtonView } from 'expo-liquid-glass-native';
import { hasAndroidLiquidButtonView } from '@/components/navigation/expoRouter55';
import { useThemeColor } from 'hooks/useThemeColor';

const INVISIBLE_TITLE_WIDE = '\u2007'.repeat(12);
const INVISIBLE_TITLE_SHORT = '\u2007'.repeat(1);

const BUTTON_H = 48;
const QR_SIZE = 72;

// ---------------------------------------------------------------------------
// Platform-specific button components (module-scoped, no closures needed)
// ---------------------------------------------------------------------------

function AndroidLiquidCapsuleButton({
  label,
  icon,
  color,
  onPress,
}: {
  label: string;
  icon: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <View className="w-full" style={{ height: BUTTON_H }}>
      <LiquidButtonView
        title={INVISIBLE_TITLE_WIDE}
        enabled
        tint="transparent"
        blurRadius={3}
        onPress={onPress}
        style={{ width: '100%', height: BUTTON_H, borderRadius: BUTTON_H / 2 }}
      />
      <View
        pointerEvents="none"
        className="absolute inset-0 flex-row items-center justify-center gap-2"
        style={{ elevation: 1 }}>
        <Icon name={icon} size={16} color={color} />
        <Text size={14} style={{ color, fontFamily: 'OxygenBold' }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

function AndroidLiquidQRButton({
  tint,
  color,
  onPress,
}: {
  tint: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <View
      className="overflow-hidden"
      style={{
        width: QR_SIZE,
        height: QR_SIZE,
        borderRadius: QR_SIZE / 2,
        transform: [{ scale: 1.3 }],
      }}>
      <LiquidButtonView
        title={INVISIBLE_TITLE_SHORT}
        enabled
        tint={tint}
        blurRadius={4}
        lensX={24}
        lensY={24}
        onPress={onPress}
        style={{ width: '100%', height: '100%' }}
      />
      <View
        pointerEvents="none"
        className="absolute inset-0 items-center justify-center"
        style={{ elevation: 1 }}>
        <Icon name="stash:qr-code" size={24} color={color} />
      </View>
    </View>
  );
}

function LiquidCapsuleButton({
  label,
  systemIcon,
  color,
  onPress,
}: {
  label: string;
  systemIcon: React.ComponentProps<typeof SwiftUIImage>['systemName'];
  color: string;
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
          <SwiftUIImage systemName={systemIcon} size={18} color={color} />
          <SwiftUIText
            modifiers={[
              font({ size: 14, weight: 'bold' }),
              foregroundStyle(color),
              padding({ vertical: 8 }),
            ]}>
            {label}
          </SwiftUIText>
        </SwiftUIHStack>
      </SwiftUIButton>
    </Host>
  );
}

function LiquidQRButton({
  tint,
  color,
  onPress,
}: {
  tint: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Host style={{ height: QR_SIZE, width: QR_SIZE }} matchContents={false}>
      <SwiftUIButton
        modifiers={[
          buttonStyle('glass'),
          frame({ height: QR_SIZE, width: QR_SIZE }),
          glassEffect({
            shape: 'circle',
            glass: { tint, variant: 'regular', interactive: true },
          }),
        ]}
        onPress={onPress}>
        <SwiftUIHStack
          alignment="center"
          modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' })]}>
          <SwiftUIImage systemName="qrcode.viewfinder" size={22} color={color} />
        </SwiftUIHStack>
      </SwiftUIButton>
    </Host>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

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
  const [foreground, shadeColor100, shadeColor300] = useThemeColor([
    'foreground',
    'shade-100',
    'shade-300',
  ] as const);

  const pagerHeight = Math.max(windowHeight * 0.3, 250);

  const { handlePermission } = useHandleCameraPermission();
  const { getBalances } = useMintManagement();

  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMintUrl = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  const swiperRef = useRef<any>(null);

  const onPageSelected = useCallback(
    async (index: number): Promise<void> => {
      setAccount(accounts[index]);
      await EnhancedHaptics.successHaptic();
    },
    [accounts, setAccount]
  );

  useEffect(() => {
    const idx = accounts.findIndex((a) => a.unit === account.unit);
    swiperRef.current?.goTo(idx);
  }, [accounts, account]);

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

  const useAndroidLiquidButtons = Platform.OS === 'android' && hasAndroidLiquidButtonView();

  const renderCapsuleButton = (
    label: string,
    systemIcon: string,
    rnIcon: string,
    onPress: () => void
  ) => {
    if (supportsLiquidGlass()) {
      return (
        <LiquidCapsuleButton
          label={label}
          systemIcon={systemIcon as any}
          color={foreground}
          onPress={onPress}
        />
      );
    }
    if (useAndroidLiquidButtons) {
      return (
        <AndroidLiquidCapsuleButton
          label={label}
          icon={rnIcon}
          color={foreground}
          onPress={onPress}
        />
      );
    }
    return (
      <Button
        text={label}
        icon={<Icon name={rnIcon} size={16} color={foreground} />}
        onPress={onPress}
        variant="secondary"
        blur={{ intensity: 70, tint: 'dark' }}
        haptics
        style={{ margin: 0, marginBottom: 0, width: '100%', minHeight: BUTTON_H }}
      />
    );
  };

  return (
    <>
      <View className="w-full" style={{ height: pagerHeight }}>
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
          {accounts.map((acc, index) => (
            <VStack key={`${acc.unit}-${index}`} align="center" justify="center" className="flex-1">
              <Account accounts={accounts} account={acc} pagerHeight={pagerHeight} />
            </VStack>
          ))}
        </Swiper>
      </View>

      <View
        className="relative w-full justify-center px-3"
        style={{ marginTop: 8, height: Math.max(QR_SIZE, BUTTON_H) }}>
        <View className="flex-row gap-3">
          <View className="flex-1">
            {renderCapsuleButton(
              'Receive',
              'arrow.down.left',
              'lucide:arrow-down-left',
              handleReceive
            )}
          </View>
          <View className="flex-1">
            {renderCapsuleButton('Send', 'arrow.up.right', 'lucide:arrow-up-right', handleSend)}
          </View>
        </View>

        <View pointerEvents="box-none" className="absolute inset-x-0 z-[1000] items-center">
          {supportsLiquidGlass() ? (
            <LiquidQRButton tint={shadeColor300} color={foreground} onPress={handleScanQR} />
          ) : useAndroidLiquidButtons ? (
            <AndroidLiquidQRButton tint={shadeColor300} color={foreground} onPress={handleScanQR} />
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
              }}
              className="items-center justify-center"
              haptics={{ type: 'impact', impactStyle: 'light' }}
              activeOpacity={0.75}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={handleScanQR}>
              <LinearGradient
                className="h-full w-full items-center justify-center rounded-full p-2"
                colors={[shadeColor100, shadeColor300]}>
                <Icon name="stash:qr-code" size={24} color={foreground} />
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </>
  );
}
