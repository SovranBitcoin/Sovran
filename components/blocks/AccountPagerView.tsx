import React, { useCallback, useEffect, useRef, useMemo } from 'react';
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

// Invisible figure-space titles to give LiquidButtonView intrinsic width
const INVISIBLE_TITLE_WIDE = '\u2007'.repeat(12);
const INVISIBLE_TITLE_SHORT = '\u2007'.repeat(1);

const BUTTON_H = 48;
const QR_SIZE = 72;

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
    <View style={{ width: '100%', height: BUTTON_H }}>
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
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 8,
          elevation: 1,
        }}>
        <Icon name={icon} size={16} color={color} />
        <Text size={14} style={{ color, fontFamily: 'OverpassSemibold' }}>
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
      style={{
        width: QR_SIZE,
        height: QR_SIZE,
        borderRadius: QR_SIZE / 2,
        overflow: 'hidden',
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
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          justifyContent: 'center',
          alignItems: 'center',
          elevation: 1,
        }}>
        <Icon name="stash:qr-code" size={24} color={color} />
      </View>
    </View>
  );
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
  const { height: windowHeight } = useWindowDimensions();
  const [foreground, shadeColor100, shadeColor300] = useThemeColor([
    'foreground',
    'shade-100',
    'shade-300',
  ] as const);

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

  // Button components
  const liquidGlassForeground = foreground;
  const qrGlassTint = shadeColor300;
  const useAndroidLiquidButtons = Platform.OS === 'android' && hasAndroidLiquidButtonView();

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

      {/* Quick action buttons — Sweep / Swap / More */}
      {/* <View style={actionStyles.row}>
        {supportsLiquidGlass() ? (
          <>
            <View style={actionStyles.button}>
              <Host style={{ height: ACTION_SIZE, width: ACTION_SIZE }} matchContents={false}>
                <SwiftUIButton
                  modifiers={[
                    buttonStyle('glass'),
                    frame({ height: ACTION_SIZE, width: ACTION_SIZE }),
                    glassEffect({
                      shape: 'circle',
                      glass: { variant: 'regular', interactive: true },
                    }),
                  ]}
                  onPress={handleSweep}>
                  <SwiftUIHStack
                    alignment="center"
                    modifiers={[
                      frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' }),
                    ]}>
                    <SwiftUIImage
                      systemName="tray.and.arrow.down"
                      size={18}
                      color={liquidGlassForeground}
                    />
                  </SwiftUIHStack>
                </SwiftUIButton>
              </Host>
              <Text size={12} semibold color={actionFg}>
                Sweep
              </Text>
            </View>
            <View style={actionStyles.button}>
              <Host style={{ height: ACTION_SIZE, width: ACTION_SIZE }} matchContents={false}>
                <SwiftUIButton
                  modifiers={[
                    buttonStyle('glass'),
                    frame({ height: ACTION_SIZE, width: ACTION_SIZE }),
                    glassEffect({
                      shape: 'circle',
                      glass: { variant: 'regular', interactive: true },
                    }),
                  ]}
                  onPress={handleSwap}>
                  <SwiftUIHStack
                    alignment="center"
                    modifiers={[
                      frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' }),
                    ]}>
                    <SwiftUIImage
                      systemName="arrow.triangle.2.circlepath"
                      size={18}
                      color={liquidGlassForeground}
                    />
                  </SwiftUIHStack>
                </SwiftUIButton>
              </Host>
              <Text size={12} semibold color={actionFg}>
                Swap
              </Text>
            </View>
            <View style={actionStyles.button}>
              <Host style={{ height: ACTION_SIZE, width: ACTION_SIZE }} matchContents={false}>
                <SwiftUIButton
                  modifiers={[
                    buttonStyle('glass'),
                    frame({ height: ACTION_SIZE, width: ACTION_SIZE }),
                    glassEffect({
                      shape: 'circle',
                      glass: { variant: 'regular', interactive: true },
                    }),
                  ]}
                  onPress={handleMore}>
                  <SwiftUIHStack
                    alignment="center"
                    modifiers={[
                      frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' }),
                    ]}>
                    <SwiftUIImage systemName="ellipsis" size={18} color={liquidGlassForeground} />
                  </SwiftUIHStack>
                </SwiftUIButton>
              </Host>
              <Text size={12} semibold color={actionFg}>
                More
              </Text>
            </View>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={actionStyles.button}
              onPress={handleSweep}
              haptics={{ type: 'impact', impactStyle: 'light' }}
              activeOpacity={0.7}>
              <View style={[actionStyles.circle, { backgroundColor: actionBg }]}>
                <Icon name="fluent:arrow-download-16-filled" size={20} color={actionFg} />
              </View>
              <Text size={12} semibold color={actionFg}>
                Sweep
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={actionStyles.button}
              onPress={handleSwap}
              haptics={{ type: 'impact', impactStyle: 'light' }}
              activeOpacity={0.7}>
              <View style={[actionStyles.circle, { backgroundColor: actionBg }]}>
                <Icon name="fluent:arrow-swap-16-filled" size={20} color={actionFg} />
              </View>
              <Text size={12} semibold color={actionFg}>
                Swap
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={actionStyles.button}
              onPress={handleMore}
              haptics={{ type: 'impact', impactStyle: 'light' }}
              activeOpacity={0.7}>
              <View style={[actionStyles.circle, { backgroundColor: actionBg }]}>
                <Icon name="tabler:dots" size={20} color={actionFg} />
              </View>
              <Text size={12} semibold color={actionFg}>
                More
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View> */}

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
            ) : useAndroidLiquidButtons ? (
              <AndroidLiquidCapsuleButton
                label="Receive"
                icon="lucide:arrow-down-left"
                color={liquidGlassForeground}
                onPress={handleReceive}
              />
            ) : (
              <Button
                text="Receive"
                icon={<Icon name="lucide:arrow-down-left" size={16} color={foreground} />}
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
            ) : useAndroidLiquidButtons ? (
              <AndroidLiquidCapsuleButton
                label="Send"
                icon="lucide:arrow-up-right"
                color={liquidGlassForeground}
                onPress={handleSend}
              />
            ) : (
              <Button
                text="Send"
                icon={<Icon name="lucide:arrow-up-right" size={16} color={foreground} />}
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
          ) : useAndroidLiquidButtons ? (
            <AndroidLiquidQRButton
              tint={qrGlassTint}
              color={liquidGlassForeground}
              onPress={handleScanQR}
            />
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
                <Icon name="stash:qr-code" size={24} color={foreground} />
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </>
  );
}
