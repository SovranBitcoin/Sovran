import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Stack } from 'expo-router';
import { Pressable, Alert, Platform } from 'react-native';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import WalletHeaderTitle from '@/components/blocks/WalletHeaderTitle';
import { ContextMenu, Host, Button as SwiftUIButton } from '@expo/ui/swift-ui';
import { frame, padding } from '@expo/ui/swift-ui/modifiers';
import { handlePOSPaymentTest } from '@/helper/nfcPosPayment';
import { useSend, useReceive } from 'hooks/coco';
import { useBtcPrice } from 'stores/pricelistStore';
import { useSettingsStore } from 'stores/settingsStore';
import { useCallback } from 'react';

// Payment limit tiers in USD
const PAYMENT_TIERS = [
  { label: 'Up to $10', usdLimit: 10, icon: 'cup.and.saucer.fill' },
  { label: 'Up to $50', usdLimit: 50, icon: 'fork.knife' },
  { label: 'Up to $100', usdLimit: 100, icon: 'cart.fill' },
  { label: 'No limit', usdLimit: undefined, icon: 'exclamationmark.triangle.fill' },
] as const;

export default function HomeLayout() {
  const iconColor = useThemeColor({}, 'text');
  const navigation = useNavigation();
  const { send } = useSend();
  const { receive } = useReceive();
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const btcPrice = useBtcPrice(displayCurrency);

  const openDrawer = () => {
    navigation.dispatch(DrawerActions.openDrawer());
  };

  // Convert USD to sats based on current BTC price
  const usdToSats = useCallback(
    (usd: number): number => {
      if (!btcPrice) return 0;
      // btcPrice is USD per BTC, 1 BTC = 100,000,000 sats
      return Math.floor((usd / btcPrice) * 100_000_000);
    },
    [btcPrice]
  );

  const handleNFCPayment = useCallback(
    async (usdLimit?: number) => {
      const maxSats = usdLimit !== undefined ? usdToSats(usdLimit) : undefined;
      const limitText =
        usdLimit !== undefined ? `$${usdLimit} (~${maxSats?.toLocaleString()} sats)` : 'unlimited';

      console.log(`[NFC Payment] Starting with limit: ${limitText}`);

      try {
        const success = await handlePOSPaymentTest(send, receive, maxSats);
        if (success) {
          Alert.alert('Payment Sent', 'Your NFC payment was successful!');
        }
      } catch (error) {
        console.error('[NFC Payment] Error:', error);
        Alert.alert('Payment Failed', 'There was an error processing your payment.');
      }
    },
    [send, receive, usdToSats]
  );

  const renderHeaderRight = () => {
    if (Platform.OS === 'ios') {
      return (
        <Host matchContents>
          <ContextMenu>
            <ContextMenu.Items>
              {PAYMENT_TIERS.map((tier) => (
                <SwiftUIButton
                  key={tier.label}
                  systemImage={tier.icon}
                  onPress={() => handleNFCPayment(tier.usdLimit)}>
                  {tier.label}
                </SwiftUIButton>
              ))}
            </ContextMenu.Items>
            <ContextMenu.Trigger>
              <SwiftUIButton
                color={iconColor}
                systemImage="wave.3.right"
                modifiers={[
                  frame({ height: 30, alignment: 'center', width: 30 }),
                  padding({ all: 4 }),
                ]}
              />
            </ContextMenu.Trigger>
          </ContextMenu>
        </Host>
      );
    }

    // Fallback for non-iOS platforms
    return (
      <Pressable
        onPress={() => {
          Alert.alert('NFC Payment Limit', 'Select your payment limit', [
            ...PAYMENT_TIERS.map((tier) => ({
              text: tier.label,
              onPress: () => handleNFCPayment(tier.usdLimit),
            })),
            { text: 'Cancel', style: 'cancel' as const },
          ]);
        }}
        style={{ margin: 2 }}>
        <IconSymbol name="wave.3.right" size={30} color={iconColor} />
      </Pressable>
    );
  };

  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          headerTransparent: true,
          headerTitle: () => <WalletHeaderTitle />,
          headerLeft: () => (
            <Pressable onPress={openDrawer} style={{ margin: 2 }}>
              <IconSymbol name="line.3.horizontal" size={30} color={iconColor} />
            </Pressable>
          ),
          headerRight: renderHeaderRight,
        }}
      />
    </Stack>
  );
}
