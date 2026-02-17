import { useThemeColor } from '@/hooks/use-theme-color';
import { Stack, router } from 'expo-router';
import { Alert, Dimensions, useWindowDimensions, View } from 'react-native';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { NfcPayment, NfcError } from '@/helper/nfc';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useBtcPrice } from 'stores/pricelistStore';
import { useSettingsStore } from 'stores/settingsStore';
import { useScanHistoryStore } from 'stores/scanHistoryStore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import { useBalanceContext, useManager } from 'coco-cashu-react';
import { useSendWithHistory } from '@/hooks/coco/useSendWithHistory';
import { captureAndStoreLocation } from '@/hooks/useTransactionLocation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMintDisplayName } from '@/helper/url';
import { formatAmount } from 'helper/currency';
import WalletHeaderTitle from '@/components/blocks/WalletHeaderTitle';
import {
  AndroidLiquidHeaderOverlay,
  AndroidLiquidHeaderTitleButton,
  buildExpoRouterHeaderOptions,
  isAndroidLiquidHeaderSupported,
} from '@/components/navigation/expoRouter55';
import { useMintManagement } from '@/hooks/coco/useMintManagement';

/** Shared header layout constants for calculating title dimensions. */
export const HEADER_LAYOUT = {
  TOOLBAR_BUTTON_WIDTH: 44, // iOS standard touch target
  HORIZONTAL_PADDING: 16, // Padding on left/right edges
  BUTTON_SPACING: 12, // Spacing between buttons and title
  BUTTON_HEIGHT: 54, // Height of the header title button
  CONTENT_PADDING_HORIZONTAL: 16, // Inner padding (8 left + 8 right)
  CONTENT_PADDING_VERTICAL: 14, // Inner padding (7 top + 7 bottom) -> 50 - 14 = 36
  /** Total overlay height: button (44) + topInset offset (8) */
  ANDROID_OVERLAY_OFFSET: 8,
  ANDROID_BUTTON_SIZE: 44,
} as const;

// Calculate header title available width
const getHeaderTitleWidth = () => {
  const windowWidth = Dimensions.get('window').width;
  const leftSide =
    HEADER_LAYOUT.TOOLBAR_BUTTON_WIDTH +
    HEADER_LAYOUT.HORIZONTAL_PADDING +
    HEADER_LAYOUT.BUTTON_SPACING;
  const rightSide =
    HEADER_LAYOUT.TOOLBAR_BUTTON_WIDTH +
    HEADER_LAYOUT.HORIZONTAL_PADDING +
    HEADER_LAYOUT.BUTTON_SPACING;
  return windowWidth - leftSide - rightSide;
};

// Calculate header title available height
const getHeaderTitleHeight = () => HEADER_LAYOUT.BUTTON_HEIGHT;

// Calculate inner content dimensions (after subtracting padding)
const getHeaderContentWidth = () =>
  getHeaderTitleWidth() - HEADER_LAYOUT.CONTENT_PADDING_HORIZONTAL;
const getHeaderContentHeight = () =>
  getHeaderTitleHeight() - HEADER_LAYOUT.CONTENT_PADDING_VERTICAL;

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
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const useAndroidLiquidHeader = isAndroidLiquidHeaderSupported();
  const { send } = useSendWithHistory();
  const manager = useManager();
  const { getMintInfo } = useMintManagement();
  const addScan = useScanHistoryStore((state) => state.addScan);
  const linkTransaction = useScanHistoryStore((state) => state.linkTransaction);

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

  // Android liquid header: mint data for the header title button
  const [headerMintInfo, setHeaderMintInfo] = useState<any>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadMintInfo() {
      if (!selectedMint) {
        if (isMounted) setHeaderMintInfo(null);
        return;
      }
      try {
        const info = await getMintInfo(selectedMint);
        if (isMounted) setHeaderMintInfo(info);
      } catch {
        if (isMounted) setHeaderMintInfo(null);
      }
    }
    loadMintInfo();
    return () => {
      isMounted = false;
    };
  }, [selectedMint, getMintInfo]);

  const headerTitleWidth = useMemo(() => {
    const side =
      HEADER_LAYOUT.TOOLBAR_BUTTON_WIDTH +
      HEADER_LAYOUT.HORIZONTAL_PADDING +
      HEADER_LAYOUT.BUTTON_SPACING;
    return windowWidth - side * 2;
  }, [windowWidth]);

  const headerMintName = selectedMint
    ? getMintDisplayName(selectedMint, { name: headerMintInfo?.name })
    : 'Change Mint';
  const headerBalance = selectedMint ? balancesWithTotal[selectedMint] || 0 : 0;
  const headerAmountLabel = useMemo(() => {
    const val = formatAmount({ amount: headerBalance, unit: 'sat' }, { useUserPreference: true });
    return `${val} sats`;
  }, [headerBalance]);

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
      // Track the last scanned raw data for linking to transaction
      let lastScannedRaw: string | null = null;

      try {
        const result = await NfcPayment.performPayment({
          createToken: async (mintUrl, amount) => {
            // useSendWithHistory returns both token and historyEntry with operationId
            const { token, historyEntry } = await send(mintUrl, amount);
            lastOperationId = historyEntry.operationId;

            // Capture location for the transaction (respects user settings)
            if (historyEntry.id) {
              await captureAndStoreLocation(historyEntry.id);
            }

            // Link the scanned data to the transaction
            if (lastScannedRaw && historyEntry.id) {
              linkTransaction(lastScannedRaw, historyEntry.id);
              lastScannedRaw = null; // Clear after linking
            }

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
            // Track for linking to transaction after send
            lastScannedRaw = raw;
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
    [
      send,
      manager,
      availableMints,
      selectedMint,
      usdToSats,
      getSelectedMint,
      keys?.pubkey,
      addScan,
      linkTransaction,
    ]
  );

  // Cross-platform fallback for selecting NFC payment tiers from header action.
  const handleNFCPaymentAlert = useCallback(() => {
    Alert.alert('NFC Payment Limit', 'Select your payment limit', [
      ...PAYMENT_TIERS.map((tier) => ({
        text: tier.label,
        onPress: () => handleNFCPayment(tier.usdLimit),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [handleNFCPayment]);

  // Use new Stack.Header and Stack.Toolbar API for iOS with Liquid Glass
  // Note: On iOS 26+, Liquid Glass requires contentStyle: { backgroundColor: 'transparent' }
  if (false) {
    return (
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: 'transparent' },
        }}>
        <Stack.Screen
          name="index"
          options={{
            title: 'Wallet',
            headerLargeTitle: false,
          }}>
          {/* Left toolbar - Menu button */}
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button icon="line.3.horizontal" onPress={openDrawer} />
          </Stack.Toolbar>

          {/* Right toolbar - NFC Payment with menu */}
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Menu icon="wave.3.right">
              {PAYMENT_TIERS.map((tier) => (
                <Stack.Toolbar.MenuAction
                  key={tier.label}
                  icon={tier.icon}
                  onPress={() => handleNFCPayment(tier.usdLimit)}>
                  {tier.label}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
        </Stack.Screen>
      </Stack>
    );
  }

  // Fallback for non-Liquid Glass (older iOS, Android, etc.)
  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          contentStyle: {
            backgroundColor: 'transparent',
          },
        }}>
        <Stack.Screen
          name="index"
          options={buildExpoRouterHeaderOptions({
            iconColor,
            headerLeftIcon: 'line.3.horizontal',
            onHeaderLeftPress: openDrawer,
            headerRightIcon: 'wave.3.right',
            onHeaderRightPress: handleNFCPaymentAlert,
            options: {
              headerShown: !useAndroidLiquidHeader,
              headerTransparent: true,
              headerTitleAlign: 'center',
              headerTitle: () => (
                <WalletHeaderTitle
                  liquidGlass
                  style={{ width: getHeaderTitleWidth(), height: getHeaderTitleHeight() }}
                  contentWidth={getHeaderContentWidth()}
                  contentHeight={getHeaderContentHeight()}
                />
              ),
            },
          })}
        />
      </Stack>
      {useAndroidLiquidHeader ? (
        <AndroidLiquidHeaderOverlay
          topInset={insets.top}
          iconColor={iconColor}
          leftIcon="line.3.horizontal"
          onLeftPress={openDrawer}
          rightIcon="wave.3.right"
          onRightPress={handleNFCPaymentAlert}
          centerWidth={headerTitleWidth}
          center={
            <AndroidLiquidHeaderTitleButton
              width={headerTitleWidth}
              lineOneText={headerMintName}
              lineTwoText={headerAmountLabel}
              avatarName={headerMintName}
              avatarPicture={headerMintInfo?.icon_url}
              onPress={() => {
                router.navigate('/(mint-flow)/list' as any);
              }}
            />
          }
        />
      ) : null}
    </View>
  );
}
