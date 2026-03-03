import { useCallback, useState } from 'react';
import { Alert, RefreshControl, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useHistoryWithMelts,
  ReceivedThisMonth,
  SpentThisMonth,
  Transactions,
} from '@/features/transactions';
import { useDeeplink } from '@/shared/hooks/useDeeplink';
import { useVersionCheck } from '@/shared/hooks/useVersionCheck';
import { useBackgroundConfig } from '@/shared/providers/BackgroundProvider';
import { AccountPagerView } from '@/features/wallet/components/AccountPagerView';
import { BitcoinNearYou } from '@/features/wallet/components/BitcoinNearYou';
import { buttonHandlerPopup, nfcPaymentSentPopup } from '@/shared/lib/popup';
import { ScrollableGradientOverlay } from '@/shared/ui/composed/BackgroundView';
import { LayoutDebugWrapper } from '@/shared/ui/composed/LayoutDebugWrapper';
import { Button } from '@/shared/ui/primitives/Button';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { isAndroidLiquidHeaderSupported } from '@/navigation/nativeTabs';
import { HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';

const ACCOUNTS = [{ unit: 'sat' }];

export function WalletScreen() {
  useBackgroundConfig({ blurMode: 'partial' });

  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const androidHeaderPadding = isAndroidLiquidHeaderSupported()
    ? insets.top + HEADER_LAYOUT.ANDROID_OVERLAY_OFFSET + HEADER_LAYOUT.ANDROID_BUTTON_SIZE
    : 0;

  const [account, setAccount] = useState(ACCOUNTS[0]);
  const [contentHeight, setContentHeight] = useState(0);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    setContentHeight(height);
  }, []);

  const { history, refresh } = useHistoryWithMelts();
  useDeeplink();
  useVersionCheck();

  return (
    <LayoutDebugWrapper
      onContentSizeChange={onContentSizeChange}
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
      contentContainerStyle={{ padding: 0, paddingTop: androidHeaderPadding }}>
      <ScrollableGradientOverlay contentHeight={contentHeight} />

      <AccountPagerView accounts={ACCOUNTS} setAccount={setAccount} account={account} />

      <View
        className="p-4 pb-24 pt-4"
        style={{
          minHeight: windowHeight - windowHeight * 0.5 - 88,
          gap: 16,
        }}>
        <Transactions account={account} showMore={true} history={history} hideExpired={true} />
        <SpentThisMonth history={history} unit={account.unit} />
        <ReceivedThisMonth history={history} unit={account.unit} />
        <BitcoinNearYou />
        {__DEV__ && (
          <HStack spacing={8} className="pt-4" style={{ flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: 120 }}>
              <Button
                text="Alert"
                variant="secondary"
                onPress={() => Alert.alert('Popup Test', 'Wallet test buttons are firing.')}
              />
            </View>
            <View style={{ flex: 1, minWidth: 120 }}>
              <Button
                text="Test Sheet"
                variant="secondary"
                onPress={() =>
                  nfcPaymentSentPopup({
                    text: 'Standard sheet test',
                    icon: 'icon:mdi:send-check',
                    duration: 2600,
                    onClose: () => {},
                  })
                }
              />
            </View>
            <View style={{ flex: 1, minWidth: 120 }}>
              <Button
                text="Test Action"
                variant="secondary"
                onPress={() =>
                  buttonHandlerPopup({
                    buttons: [
                      {
                        text: 'Action A',
                        variant: 'primary',
                        onPress: async (close) => close({} as any),
                      },
                    ],
                  })
                }
              />
            </View>
          </HStack>
        )}
      </View>
    </LayoutDebugWrapper>
  );
}
