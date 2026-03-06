import { useCallback, useEffect, useState } from 'react';
import * as Updates from 'expo-updates';
import { RefreshControl, useWindowDimensions } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch } from 'react-redux';
import type { AppThunk } from 'redux/store/reducer';

import {
  useHistoryWithMelts,
  ReceivedThisMonth,
  SpentThisMonth,
  Transactions,
} from '@/features/transactions';
import { useDeeplink } from '@/shared/hooks/useDeeplink';
import { useVersionCheck } from '@/shared/hooks/useVersionCheck';
import { useBackgroundConfig } from '@/shared/providers/BackgroundProvider';
import { useInitializationReset } from '@/shared/providers/InitializationProvider';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { resetApp } from '@/redux/store';
import { AccountPagerView } from '@/features/wallet/components/AccountPagerView';
import { BitcoinNearYou } from '@/features/wallet/components/BitcoinNearYou';
import {
  createAndSwitchProfile,
  isProfileTransitionInProgress,
  switchToExistingProfile,
  switchToImportedProfile,
} from '@/shared/lib/profile/profileSessionOrchestrator';
import { useProfileActionStore } from '@/shared/stores/runtime/profileActionStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { ScrollableGradientOverlay } from '@/shared/ui/composed/BackgroundView';
import { LayoutDebugWrapper } from '@/shared/ui/composed/LayoutDebugWrapper';
import { View } from '@/shared/ui/primitives/View/View';
import { isAndroidLiquidHeaderSupported } from '@/navigation/nativeTabs';
import { HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';

const ACCOUNTS = [{ unit: 'sat' }];

export function WalletScreen() {
  useBackgroundConfig({ blurMode: 'partial' });

  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { getKeysForAccount } = useNostrKeysContext();
  const { resetStages, cancelResetStages } = useInitializationReset();
  const pendingAction = useProfileActionStore((s) => s.pendingAction);
  const clearPendingAction = useProfileActionStore((s) => s.clearPendingAction);
  const dispatch = useDispatch();

  const androidHeaderPadding = isAndroidLiquidHeaderSupported()
    ? insets.top + HEADER_LAYOUT.ANDROID_OVERLAY_OFFSET + HEADER_LAYOUT.ANDROID_BUTTON_SIZE
    : 0;

  const [account, setAccount] = useState(ACCOUNTS[0]);
  const [contentHeight, setContentHeight] = useState(0);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    setContentHeight(height);
  }, []);

  useEffect(() => {
    if (!isFocused || !pendingAction) return;
    if (isProfileTransitionInProgress()) return;

    const action = pendingAction;
    clearPendingAction();

    const execute = async () => {
      switch (action.type) {
        case 'create-derived-profile':
          await createAndSwitchProfile({
            getKeysForAccount,
            resetStages,
            cancelResetStages,
          });
          break;
        case 'switch-profile':
          await switchToExistingProfile({
            accountIndex: action.accountIndex,
            resetStages,
            cancelResetStages,
          });
          break;
        case 'activate-imported-profile':
          if (!useProfileStore.getState().hasPubkey(action.pubkeyHex)) {
            useProfileStore
              .getState()
              .addProfile(action.accountIndex, action.pubkeyHex, 'imported');
          }

          await switchToImportedProfile({
            accountIndex: action.accountIndex,
            resetStages,
            cancelResetStages,
          });
          break;
        case 'delete-account':
          await (dispatch as (thunk: AppThunk) => Promise<void>)(resetApp());
          await Updates.reloadAsync();
          break;
      }
    };

    void execute();
  }, [
    isFocused,
    pendingAction,
    clearPendingAction,
    getKeysForAccount,
    resetStages,
    cancelResetStages,
    dispatch,
  ]);

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
      </View>
    </LayoutDebugWrapper>
  );
}
