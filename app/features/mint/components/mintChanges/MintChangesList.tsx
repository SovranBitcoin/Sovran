/**
 * Notifications → Mints. What the mints in this wallet changed about their own
 * NUT-06 info, newest first, one row per update — a mint that did three things
 * in one revision gets three rows, because each is a separate thing to know.
 *
 * Scope is deliberate: only trusted mints. When none of them changed there is
 * no ecosystem-wide fallback — a quiet empty state is the honest answer.
 */
import { useCallback, useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, type ViewToken } from 'react-native';
import opacity from 'hex-color-opacity';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { MintChangeRow } from './MintChangeRow';
import { useMintChanges } from '@/features/mint/hooks/useMintChanges';
import type { MintChangeUpdate } from '@/features/mint/lib/mintChanges/groupEntries';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useTabBarBottomPadding } from '@/shared/hooks/useTabBarBottomPadding';
import {
  useVisualListLogger,
  visualViewabilityRange,
  VISUAL_LIST_VIEWABILITY_CONFIG,
} from '@/shared/lib/contentShiftLog';
import { cashuLog } from '@/shared/lib/logger';
import { alpha, spacing } from '@/shared/styles/tokens';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { View } from '@/shared/ui/primitives/View/View';

const MINT_CHANGES_VISUAL_SCOPE = 'feed.notifications.mints.list';

function mintChangeVisualToken(token: ViewToken) {
  return {
    index: typeof token.index === 'number' ? token.index : null,
    key: token.key,
    isViewable: token.isViewable,
    item: token.item as MintChangeUpdate,
  };
}

export function MintChangesList() {
  const { updates, trustedMintCount, isLoading, isRefreshing, errorMessage, refresh } =
    useMintChanges();
  const [foreground, separator] = useThemeColor(['foreground', 'separator-secondary'] as const);
  const tabBarPadding = useTabBarBottomPadding();

  const phase = isLoading ? 'initial-loading' : isRefreshing ? 'refreshing' : 'ready';
  const { onViewableItemsChanged: onVisualViewableItemsChanged } =
    useVisualListLogger<MintChangeUpdate>({
      scope: MINT_CHANGES_VISUAL_SCOPE,
      surface: 'notifications',
      component: 'MintChangesFlatList',
      phase,
      extra: () => ({ items: updates.length, trustedMintCount }),
      getItemKey: (update) => update.id,
      getItemContext: (update) => ({ itemType: 'mint-change', rowLabel: update.host }),
    });

  const handleViewableItemsChanged = useCallback(
    ({ viewableItems, changed }: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      onVisualViewableItemsChanged({
        ...visualViewabilityRange([...viewableItems, ...changed]),
        viewableItems: viewableItems.map(mintChangeVisualToken),
        changed: changed.map(mintChangeVisualToken),
      });
    },
    [onVisualViewableItemsChanged]
  );

  const openMint = useCallback((update: MintChangeUpdate) => {
    cashuLog.info('mint.changes.open', {
      kind: update.phrase.icon,
      hasMintUrl: !!update.mintUrl,
      mintUrlLength: update.mintUrl.length,
    });
    router.push({
      pathname: '/(drawer)/(tabs)/notifications/mint-changes',
      params: { mintUrl: update.mintUrl },
    });
  }, []);

  const contentContainerStyle = useMemo(
    () => [
      styles.listContent,
      { paddingBottom: tabBarPadding },
      updates.length === 0 && styles.emptyListContent,
    ],
    [updates.length, tabBarPadding]
  );

  const renderSeparator = useCallback(
    () => <View style={[styles.separator, { backgroundColor: separator }]} />,
    [separator]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: MintChangeUpdate; index: number }) => (
      <VisualLayoutProbe
        scope={MINT_CHANGES_VISUAL_SCOPE}
        surface="notifications"
        component="MintChangeRow"
        itemKey={item.id}
        itemType="mint-change"
        index={index}>
        <MintChangeRow update={item} onPress={openMint} />
      </VisualLayoutProbe>
    ),
    [openMint]
  );

  const refreshControl = useMemo(
    () => <RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={foreground} />,
    [isRefreshing, refresh, foreground]
  );

  const listEmpty = useMemo(() => {
    if (isLoading) {
      return <Spinner size={22} color={opacity(foreground, alpha.strong)} style={styles.loader} />;
    }
    if (errorMessage) {
      return (
        <EmptyState
          icon="mdi:alert-circle-outline"
          title="Mint updates unavailable"
          subtitle={errorMessage}
        />
      );
    }
    return (
      <EmptyState
        icon="mingcute:bank-fill"
        title="No mint updates"
        subtitle={
          trustedMintCount === 0
            ? 'Add a mint to follow what it changes about itself.'
            : `Nothing new from your ${trustedMintCount === 1 ? 'mint' : `${trustedMintCount} mints`}.`
        }
      />
    );
  }, [isLoading, errorMessage, foreground, trustedMintCount]);

  return (
    <FlatList
      testID="mint-changes-list"
      data={updates}
      keyExtractor={(update) => update.id}
      contentContainerStyle={contentContainerStyle}
      contentInsetAdjustmentBehavior="never"
      refreshControl={refreshControl}
      ItemSeparatorComponent={renderSeparator}
      ListEmptyComponent={listEmpty}
      viewabilityConfig={VISUAL_LIST_VIEWABILITY_CONFIG}
      onViewableItemsChanged={handleViewableItemsChanged}
      renderItem={renderItem}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingVertical: spacing.sm,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    // Clears the reason glyph and the mint icon, like the notification list's
    // separator clears its glyph + avatar.
    marginLeft: 114,
  },
  loader: {
    alignSelf: 'center',
  },
});
