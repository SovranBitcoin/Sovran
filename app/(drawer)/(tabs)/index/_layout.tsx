import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Stack, router } from 'expo-router';
import { Pressable, Alert, Platform } from 'react-native';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import WalletHeaderTitle from '@/components/blocks/WalletHeaderTitle';
import { ContextMenu, Host, Button as SwiftUIButton } from '@expo/ui/swift-ui';
import { frame, padding } from '@expo/ui/swift-ui/modifiers';
import { NfcPayment, NfcError } from '@/helper/nfc';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useBtcPrice } from 'stores/pricelistStore';
import { useSettingsStore } from 'stores/settingsStore';
import { useScanHistoryStore } from 'stores/scanHistoryStore';
import { useCallback } from 'react';
import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import { useBalanceContext, useManager } from 'coco-cashu-react';
import { useSendWithHistory } from '@/hooks/coco/useSendWithHistory';

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
  const { send } = useSendWithHistory();
  const manager = useManager();
  const addScan = useScanHistoryStore((state) => state.addScan);

  // Get user's selected mint for NFC payments
  const { keys } = useNostrKeysContext();
  const getSelectedMint = useMintStore((state) => state.getSelectedMint);
  const selectedMint = keys?.pubkey ? getSelectedMint(keys.pubkey) : undefined;

  // Get available mints and their balances for NFC payments
  // Filter out 'total' key - it's the aggregate balance, not a mint URL
  const { balance: balancesWithTotal } = useBalanceContext();
  const { total: _total, ...availableMints } = balancesWithTotal;

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
      console.log(`[NFC Payment] User pubkey: ${keys?.pubkey || 'none'}`);
      console.log(`[NFC Payment] Selected mint from store: ${selectedMint || 'none'}`);
      console.log(`[NFC Payment] Available mints:`, Object.keys(availableMints));
      console.log(`[NFC Payment] Available mints with balances:`, availableMints);

      // Debug: Get fresh value from store
      const freshSelectedMint = keys?.pubkey ? getSelectedMint(keys.pubkey) : undefined;
      console.log(`[NFC Payment] Fresh selected mint from store: ${freshSelectedMint || 'none'}`);

      // Debug: Get all selected mints
      const allSelectedMints = useMintStore.getState().getAllSelectedMints();
      console.log(`[NFC Payment] All selected mints in store:`, allSelectedMints);

      if (!send || !manager) {
        Alert.alert('Error', 'Wallet not ready. Please try again.');
        return;
      }

      // Use fresh value from store to avoid stale closure issues
      const mintToUse = freshSelectedMint || selectedMint;
      console.log(`[NFC Payment] Using mint for payment: ${mintToUse || 'none'}`);

      // Track the operation ID for rollback if needed
      let lastOperationId: string | null = null;

      try {
        const result = await NfcPayment.performPayment({
          createToken: async (mintUrl, amount) => {
            // useSendWithHistory returns both token and historyEntry with operationId
            const { token, historyEntry } = await send(mintUrl, amount);
            lastOperationId = historyEntry.operationId;
            console.log(`[NFC Payment] Token created, operationId: ${lastOperationId}`);
            return getEncodedTokenV4(token);
          },
          recoverToken: async () => {
            // Use rollback instead of receive for proper recovery
            if (lastOperationId) {
              console.log(`[NFC Payment] Rolling back operation: ${lastOperationId}`);
              await manager.send.rollback(lastOperationId);
              console.log(`[NFC Payment] Rollback successful`);
            } else {
              console.warn('[NFC Payment] No operationId available for rollback');
            }
          },
          availableMints,
          preferredMint: mintToUse,
          maxAmountSats,
          onScanRead: (raw) => {
            // Log NFC scan to history regardless of payment outcome
            addScan(raw, raw, 'ecash', 'nfc');
          },
          onLightningInvoice: (invoice, amount) => {
            // Log to scan history as lightning via NFC
            addScan(invoice, invoice, 'lightning', 'nfc');

            if (amount) {
              // Always go through mintSelect for Lightning invoices
              // This lets the user choose which mint to use and validates fees
              router.navigate({
                pathname: '/(send-flow)/mintSelect' as any,
                params: {
                  to: 'meltQuote',
                  unit: 'sat',
                  minAmount: String(amount),
                  invoice, // Pass invoice to be forwarded to meltQuote
                },
              });
            } else {
              // No amount in invoice - go to currency screen to enter amount
              router.navigate({
                pathname: '/(send-flow)/currency' as any,
                params: { to: 'meltQuote', lnUrlOrAddress: invoice, unit: 'sat' },
              });
            }
          },
        });

        console.log('[NFC Payment] Success:', result);
        // Don't show success alert if Lightning invoice was detected (handled by onLightningInvoice)
        // if (result.mintUrl) {
        //   Alert.alert('Payment Sent', `Successfully sent ${result.amount} sats via NFC!`);
        // }
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
            case 'NO_AVAILABLE_MINTS':
              Alert.alert(
                'No Mints Available',
                'You need to add a mint to your wallet before making NFC payments.'
              );
              break;
            case 'NO_COMPATIBLE_MINT':
              Alert.alert(
                'Incompatible Terminal',
                "This terminal requires a mint you don't have. Add one of the supported mints to your wallet."
              );
              break;
            case 'INSUFFICIENT_BALANCE':
            case 'INSUFFICIENT_BALANCE_AT_COMPATIBLE_MINT':
              Alert.alert('Insufficient Balance', error.message);
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
    [send, manager, availableMints, selectedMint, usdToSats, getSelectedMint, keys?.pubkey, addScan]
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
