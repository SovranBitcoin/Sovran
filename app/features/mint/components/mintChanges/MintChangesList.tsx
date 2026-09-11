/**
 * Notifications → Mints. What the mints in this wallet changed about their own
 * NUT-06 info, newest first, one row per update — a mint that did three things
 * in one revision gets three rows, because each is a separate thing to know.
 *
 * Scope is deliberate: only trusted mints. When none of them changed there is
 * no ecosystem-wide fallback — a quiet empty state is the honest answer.
 */
import { RefreshControl, StyleSheet, type ViewToken } from 'react-native';
import { withAlpha } from '@/shared/lib/color';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { MintChangeRow } from './MintChangeRow';
import { useMintChanges } from '@/features/mint/hooks/useMintChanges';
import type { MintChangeUpdate } from '@/features/mint/lib/mintChanges/groupEntries';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import {
  useVisualListLogger,
  visualToken,
  visualViewabilityRange,
  VISUAL_LIST_VIEWABILITY_CONFIG,
} from '@/shared/lib/contentShiftLog';
import { cashuLog } from '@/shared/lib/logger';
import { alpha, spacing } from '@/shared/styles/tokens';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { List } from '@/shared/ui/composed/List';
import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { View } from '@/shared/ui/primitives/View/View';

const MINT_CHANGES_VISUAL_SCOPE = 'feed.notifications.mints.list';

function openMint(update: MintChangeUpdate): void {
  cashuLog.info('mint.changes.open', {
    kind: update.phrase.icon,
    hasMintUrl: !!update.mintUrl,
    mintUrlLength: update.mintUrl.length,
  });
  router.push({
    pathname: '/(drawer)/(tabs)/notifications/mint-changes',
    params: { mintUrl: update.mintUrl },
  });
}

export function MintChangesList() {
  const { updates, trustedMintCount, isLoading, isRefreshing, errorMessage, refresh } =
    useMintChanges();
  const [foreground, separator] = useThemeColor(['foreground', 'separator-secondary'] as const);

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

  const handleViewableItemsChanged = ({
    viewableItems,
    changed,
  }: {
    viewableItems: ViewToken[];
    changed: ViewToken[];
  }) => {
    onVisualViewableItemsChanged({
      ...visualViewabilityRange([...viewableItems, ...changed]),
      viewableItems: viewableItems.map(visualToken<MintChangeUpdate>),
      changed: changed.map(visualToken<MintChangeUpdate>),
    });
  };

  const contentContainerStyle = [
    styles.listContent,
    updates.length === 0 && styles.emptyListContent,
  ];

  const renderSeparator = () => <View style={[styles.separator, { backgroundColor: separator }]} />;

  const renderItem = ({ item, index }: { item: MintChangeUpdate; index: number }) => (
    <VisualLayoutProbe
      scope={MINT_CHANGES_VISUAL_SCOPE}
      surface="notifications"
      component="MintChangeRow"
      itemKey={item.id}
      itemType="mint-change"
      index={index}>
      <MintChangeRow update={item} onPress={openMint} />
    </VisualLayoutProbe>
  );

  const refreshControl = (
    <RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={foreground} />
  );

  const listEmpty = isLoading ? (
    <Spinner size={22} color={withAlpha(foreground, alpha.strong)} style={styles.loader} />
  ) : errorMessage ? (
    <EmptyState
      icon="mdi:alert-circle-outline"
      title="Mint updates unavailable"
      subtitle={errorMessage}
    />
  ) : (
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

  return (
    <List
      screen
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
