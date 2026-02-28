import { useHistoryWithMelts } from 'hooks/coco/useHistoryWithMelts';
import { AccountPagerView } from 'components/blocks/AccountPagerView';
import { DebugBalancePanel } from 'components/blocks/DebugBalancePanel';
import { BitcoinNearYou } from 'components/blocks/BitcoinNearYou';
import { ReceivedThisMonth, SpentThisMonth } from 'components/blocks/MonthlyChart';
import { Transactions } from 'components/blocks/Transactions';
import { ScrollableGradientOverlay } from 'components/ui/BackgroundView';
import { View } from 'components/ui/View/View';
import { useDeeplink } from 'hooks/useDeeplink';
import { useVersionCheck } from 'hooks/useVersionCheck';
import { useBackgroundConfig } from 'providers/BackgroundProvider';
import { memo, useCallback, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, useWindowDimensions } from 'react-native';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { LayoutDebugWrapper } from '@/app/(drawer)/(tabs)/example';
import { useSettingsStore } from 'stores/settingsStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isAndroidLiquidHeaderSupported } from '@/components/navigation/expoRouter55';
import { HEADER_LAYOUT, MOCK_NFC_SUCCESS_SATS } from '@/constants/wallet-header';
import { NfcSuccessConfirmCircleIcon } from '@/components/overlays/NfcSuccessOverlay';
import { popup } from '@/helper/popup';
import { AmountFormatter } from '@/components/ui/AmountFormatter';
import { Text } from '@/components/ui/Text';

function TabOneScreen() {
  // Register this tab's background configuration - animates on focus
  useBackgroundConfig({ blurMode: 'partial' });

  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const devMode = useSettingsStore((state) => state.experimental);
  const supportedUnits = useMemo(() => ['sat', 'usd', 'eur', 'gbp'], []);

  // When the native header is hidden (Android liquid glass), add padding so
  // content doesn't render underneath the overlay header.
  const androidHeaderPadding = isAndroidLiquidHeaderSupported()
    ? insets.top + HEADER_LAYOUT.ANDROID_OVERLAY_OFFSET + HEADER_LAYOUT.ANDROID_BUTTON_SIZE
    : 0;

  const accounts = useMemo(
    () =>
      [
        {
          unit: 'sat',
        },
        // {
        //   unit: 'usd',
        // },
        // {
        //   unit: 'eur',
        // },
        // {
        //   unit: 'gbp',
        // },
      ].filter((u) => supportedUnits.includes(u.unit)),
    [supportedUnits]
  );

  const [account, setAccount] = useState(accounts[0]);
  const [contentHeight, setContentHeight] = useState(0);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    setContentHeight(height);
  }, []);

  const onRefresh = useCallback(async () => {}, []);

  const { history } = useHistoryWithMelts();
  useDeeplink();
  useVersionCheck();

  return (
    <LayoutDebugWrapper
      onContentSizeChange={onContentSizeChange}
      refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} />}
      contentContainerStyle={{ padding: 0, paddingTop: androidHeaderPadding }}>
      {/* Scrollable gradient overlay - must be first child */}
      <ScrollableGradientOverlay contentHeight={contentHeight} />

      <AccountPagerView accounts={accounts} setAccount={setAccount} account={account} />
      {devMode ? (
        <View className="px-4 pb-2" style={styles.devSection}>
          <DebugBalancePanel />
          <TouchableOpacity
            onPress={() =>
              popup({
                message: 'Payment sent',
                text: (
                  <Text
                    style={{
                      alignItems: 'center',
                    }}>
                    <AmountFormatter
                      size={12}
                      weight="heavy"
                      amount={MOCK_NFC_SUCCESS_SATS}
                      unit="sat"
                    />
                    <Text size={12} weight="heavy">
                      {' sent'}
                    </Text>
                  </Text>
                ),
                variant: 'sheet',
                duration: 2600,
                icon: <NfcSuccessConfirmCircleIcon color="#22c55e" size={88} startDelayMs={0} />,
              })
            }
            style={styles.devNfcPreviewButton}>
            <Text style={styles.devNfcPreviewText}>
              Preview NFC success ({MOCK_NFC_SUCCESS_SATS} sats)
            </Text>
          </TouchableOpacity>
          {/* Toast variants */}
          <Text style={styles.devSectionLabel}>Toast Variants</Text>
          <View style={styles.popupButtonRow}>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() =>
                popup({ message: 'Success!', text: 'Operation completed.', type: 'success' })
              }>
              <Text style={styles.devNfcPreviewText}>Success</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() =>
                popup({ message: 'Warning', text: 'Please check your input.', type: 'warning' })
              }>
              <Text style={styles.devNfcPreviewText}>Warning</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() =>
                popup({ message: 'Error', text: 'Something went wrong.', type: 'error' })
              }>
              <Text style={styles.devNfcPreviewText}>Error</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() => popup({ message: 'Info', text: 'Just a heads up.', type: 'info' })}>
              <Text style={styles.devNfcPreviewText}>Info</Text>
            </TouchableOpacity>
          </View>
          {/* Toast options */}
          <Text style={styles.devSectionLabel}>Toast Options</Text>
          <View style={styles.popupButtonRow}>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() => popup('ecash_token_copied')}>
              <Text style={styles.devNfcPreviewText}>Message Code</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() => popup({ message: 'Custom Emoji', emoji: '🔑', type: 'success' })}>
              <Text style={styles.devNfcPreviewText}>Custom Emoji</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() =>
                popup({ message: 'Quick', text: 'Gone in 1s.', type: 'info', duration: 1000 })
              }>
              <Text style={styles.devNfcPreviewText}>Short Duration</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() =>
                popup({
                  message: 'With Callback',
                  type: 'success',
                  onClose: () => console.log('[popup] onClose fired'),
                })
              }>
              <Text style={styles.devNfcPreviewText}>onClose</Text>
            </TouchableOpacity>
          </View>
          {/* Sheet variants */}
          <Text style={styles.devSectionLabel}>Sheet Variants</Text>
          <View style={styles.popupButtonRow}>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() =>
                popup({
                  message: 'Basic Sheet',
                  text: 'Detached bottom sheet with one button.',
                  variant: 'sheet',
                  buttons: [{ text: 'OK' }],
                })
              }>
              <Text style={styles.devNfcPreviewText}>Basic</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() =>
                popup({
                  message: 'Multiple Actions',
                  text: 'Primary action + secondary dismiss.',
                  variant: 'sheet',
                  buttons: [
                    {
                      text: 'Confirm',
                      onPress: () => popup({ message: 'Confirmed!', type: 'success' }),
                    },
                    { text: 'Cancel' },
                  ],
                })
              }>
              <Text style={styles.devNfcPreviewText}>Multi-Button</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() =>
                popup({
                  message: 'Navigate',
                  text: 'Button navigates to a page.',
                  variant: 'sheet',
                  buttons: [{ text: 'Go to Theme', page: 'settings-pages/theme' }],
                })
              }>
              <Text style={styles.devNfcPreviewText}>Page Nav</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.popupButtonRow}>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() =>
                popup({
                  message: 'Custom Emoji',
                  text: 'Sheet with custom emoji override.',
                  emoji: '🛡️',
                  variant: 'sheet',
                  buttons: [{ text: 'Cool' }],
                })
              }>
              <Text style={styles.devNfcPreviewText}>Custom Emoji</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() =>
                popup({
                  message: 'Non-Dismissable',
                  text: 'You must press the button to close.',
                  variant: 'sheet',
                  dismissable: false,
                  buttons: [{ text: 'I understand' }],
                })
              }>
              <Text style={styles.devNfcPreviewText}>Non-Dismiss</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() =>
                popup({
                  message: 'With onClose',
                  text: 'onClose callback fires on any close path.',
                  variant: 'sheet',
                  buttons: [{ text: 'Close' }],
                  onClose: () => console.log('[popup] sheet onClose fired'),
                })
              }>
              <Text style={styles.devNfcPreviewText}>onClose</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devPopupButton}
              onPress={() =>
                popup({
                  message: 'Auto-Dismiss Sheet',
                  text: 'This sheet closes automatically after 3 seconds.',
                  variant: 'sheet',
                  duration: 3000,
                })
              }>
              <Text style={styles.devNfcPreviewText}>Duration 3s</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      <View
        className="p-4 pb-24 pt-4"
        style={{
          // Account for the AccountPagerView height (50% of screen) plus button area (~88px)
          minHeight: windowHeight - windowHeight * 0.5 - 88,
          gap: 16,
        }}>
        <Transactions account={account} showMore={true} history={history} hideExpired={true} />
        <SpentThisMonth history={history} unit={account.unit} />
        <ReceivedThisMonth history={history} unit={account.unit} />
        <BitcoinNearYou />
      </View>
    </LayoutDebugWrapper>
  );
}

const styles = StyleSheet.create({
  devSection: { gap: 8 },
  devNfcPreviewButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  devNfcPreviewText: { color: '#fff', fontSize: 14 },
  devSectionLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 1,
  },
  popupButtonRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  devPopupButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
  },
});

export default memo(TabOneScreen);
