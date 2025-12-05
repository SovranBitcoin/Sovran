import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Stack } from 'expo-router';
import { Pressable, Alert, Platform } from 'react-native';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import WalletHeaderTitle from '@/components/blocks/WalletHeaderTitle';
import { ContextMenu, Host, Button as SwiftUIButton } from '@expo/ui/swift-ui';
import { frame, padding } from '@expo/ui/swift-ui/modifiers';
import { NfcPayment, NfcError } from '@/helper/nfc';
// import { useSend, useReceive } from 'hooks/coco';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useBtcPrice } from 'stores/pricelistStore';
import { useSettingsStore } from 'stores/settingsStore';
import { useCallback } from 'react';
import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import { useReceive, useSend } from 'coco-cashu-react';

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

  // Get user's selected mint for NFC payments
  const { keys } = useNostrKeysContext();
  const getSelectedMint = useMintStore((state) => state.getSelectedMint);
  const selectedMint = keys?.pubkey ? getSelectedMint(keys.pubkey) : undefined;

  // Get BTC price for USD to sats conversion
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const btcPrice = useBtcPrice(displayCurrency);

  const openDrawer = () => {
    navigation.dispatch(DrawerActions.openDrawer());
  };

  // Convert USD to sats based on current BTC price
  const usdToSats = useCallback(
    (usd: number): number | undefined => {
      if (!btcPrice) return undefined;
      // btcPrice is USD per BTC, 1 BTC = 100,000,000 sats
      return Math.floor((usd / btcPrice) * 100_000_000);
    },
    [btcPrice]
  );

  const handleNFCPayment = useCallback(
    async (usdLimit?: number) => {
      // Convert USD limit to sats
      const maxAmountSats = usdLimit !== undefined ? usdToSats(usdLimit) : undefined;

      console.log('[NFC Payment] Starting...');
      console.log(`[NFC Payment] USD limit: ${usdLimit ?? 'none'}`);
      console.log(`[NFC Payment] Sats limit: ${maxAmountSats ?? 'none'}`);
      console.log(`[NFC Payment] Preferred mint: ${selectedMint || 'none'}`);

      if (!send || !receive) {
        Alert.alert('Error', 'Wallet not ready. Please try again.');
        return;
      }

      try {
        const result = await NfcPayment.performPayment({
          createToken: async (mintUrl, amount) => {
            const token = await send(mintUrl, amount);
            return getEncodedTokenV4(token);
          },
          recoverToken: async (token) => {
            await receive(token);
          },
          preferredMint: selectedMint,
          maxAmountSats,
        });

        console.log('[NFC Payment] Success:', result);
        Alert.alert('Payment Sent', `Successfully sent ${result.amount} sats via NFC!`);
      } catch (error) {
        console.error('[NFC Payment] Error:', error);

        if (error instanceof NfcError) {
          // Handle specific error codes
          switch (error.code) {
            case 'AMOUNT_EXCEEDED':
              Alert.alert(
                'Payment Rejected',
                `The merchant requested more than your limit of ${maxAmountSats?.toLocaleString()} sats.`
              );
              break;
            case 'NOT_SUPPORTED':
              Alert.alert('NFC Not Supported', 'Your device does not support NFC.');
              break;
            case 'NOT_ENABLED':
              Alert.alert(
                'NFC Disabled',
                'Please enable NFC in your device settings and try again.'
              );
              break;
            case 'EMPTY_PAYMENT_REQUEST':
              Alert.alert(
                'POS Not Ready',
                'The terminal returned an empty payment request. Please try again.'
              );
              break;
            case 'TAG_LOST':
            case 'TRANSCEIVE_FAILED':
              Alert.alert(
                'Connection Lost',
                'Lost connection to the terminal. Please hold your device steady and try again.'
              );
              break;
            case 'TECHNOLOGY_REQUEST_FAILED':
              Alert.alert(
                'Connection Failed',
                'Could not connect to the terminal. Make sure NFC is enabled and try again.'
              );
              break;
            default:
              Alert.alert('Payment Failed', error.message);
          }
        } else {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          Alert.alert('Payment Failed', errorMessage);
        }
      }
    },
    [send, receive, selectedMint, usdToSats]
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
    <Stack
      screenOptions={{
        contentStyle: {
          backgroundColor: 'transparent',
        },
      }}>
      <Stack.Screen
        name="index"
        options={{
          headerTransparent: true,
          headerTitleAlign: 'center',
          headerTitle: () => <WalletHeaderTitle style={{ marginLeft: -42 }} />,
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
