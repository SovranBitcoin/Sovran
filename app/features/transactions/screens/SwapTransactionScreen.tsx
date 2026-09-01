/**
 * @fileoverview Swap Transaction Detail Screen
 *
 * Displays a grouped swap run composed of multiple steps.
 * Layout follows the same pattern as Lightning send / receive / SendToken screens:
 *   1. Header with total amount + swap icon
 *   2. Leg cards
 *   3. Section with metadata (Status, Steps, Fees, Date)
 *
 * When legs are part of a middleman chain, they are grouped into a single card.
 * Failed direct legs are hidden when a successful chain covers the same route.
 * Consecutive entries on the same mint omit the redundant arrow separator.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { MeltQuoteState } from '@cashu/cashu-ts';
import { asHistoryEntry } from '@/shared/lib/cashu/syntheticHistory';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  LinearTransition,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { View } from '@/shared/ui/primitives/View/View';
import { Text, UntranslatedText } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Screen } from '@/shared/ui/composed/Screen';
import { TransactionDetailShell } from '@/features/transactions/components/detail/TransactionDetailShell';
import { useHistoryWithMelts } from '@/features/transactions';
import type { HistoryEntry, MeltHistoryEntry, MintHistoryEntry } from '@cashu/coco-core';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { navigateToTransactionDetail } from '@/shared/lib/nav/transactionDetailRoutes';
import {
  useSwapTransactionsStore,
  type SwapLeg,
} from '@/shared/stores/profile/swapTransactionsStore';
import { withAlpha } from '@/shared/lib/color';
import { DetailsList } from '@/shared/ui/composed/DetailsList';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import {
  TransferEntryRow,
  TransferSeparator,
  TransferCard,
  TransferErrorBanner,
} from '@/shared/blocks/transfer';
import { formatDate } from '@/shared/lib/date';
import { formatAmount } from '@/shared/lib/currency';
import { getMintDisplayName } from '@/shared/lib/url';
import { useMintManagement } from '@/features/mint';
import { getTransactionActionDirection } from '@/features/transactions/lib/transactionPresentation';
import Icon from 'assets/icons';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, useLifecycleLogger } from '@/shared/lib/logger';

interface Props {
  groupId: string | undefined;
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Groups consecutive legs that share a chainId into a single visual group. */
interface LegGroup {
  id: string;
  chainId: string | null;
  legs: SwapLeg[];
  /** Full chain path when this is a middleman group. */
  chainPath?: string[];
}

function groupLegs(legs: SwapLeg[]): LegGroup[] {
  const groups: LegGroup[] = [];

  for (const leg of legs) {
    if (leg.chainId) {
      // Try to append to the last group if it shares the same chainId
      const last = groups[groups.length - 1];
      if (last && last.chainId === leg.chainId) {
        last.legs.push(leg);
        continue;
      }
      // Start a new chain group
      groups.push({
        id: `chain-${leg.chainId}`,
        chainId: leg.chainId,
        legs: [leg],
        chainPath: leg.chainPath,
      });
    } else {
      // Standalone leg
      groups.push({
        id: leg.id,
        chainId: null,
        legs: [leg],
      });
    }
  }

  return groups;
}

// -----------------------------------------------------------------------
// Helpers for building TransferEntryRow props from history entries
// -----------------------------------------------------------------------

function buildSwapEntryRowProps(
  historyEntry: MintHistoryEntry | MeltHistoryEntry,
  mintIconUrl: string | undefined,
  mintName: string
) {
  const type = getTransactionActionDirection(historyEntry.type);
  const numericAmount = amountToNumber(historyEntry.amount);
  const fiatAmount = formatAmount(
    { amount: Math.abs(numericAmount), unit: historyEntry.unit },
    { displayAs: 'usd' }
  );

  const handlePress = () => {
    navigateToTransactionDetail(historyEntry, 'swap.transaction.row');
  };

  return {
    type,
    mintIconUrl,
    mintName,
    amount: numericAmount,
    unit: historyEntry.unit,
    subtitle: historyEntry.createdAt
      ? formatDate(historyEntry.createdAt, 'short-date-time')
      : 'Unconfirmed',
    secondarySubtitle: fiatAmount,
    onPress: handlePress,
  };
}

// -----------------------------------------------------------------------
// Sub-component: compact collapsed row for a leg group
// -----------------------------------------------------------------------

interface CollapsedLegGroupProps {
  legGroup: LegGroup;
  mintInfoMap: Record<string, { name?: string; icon_url?: string } | null>;
}

const CollapsedLegGroup = React.memo(({ legGroup, mintInfoMap }: CollapsedLegGroupProps) => {
  const foreground = useThemeColor('foreground');

  // Source = first leg's from, Destination = last leg's to
  const firstLeg = legGroup.legs[0];
  const lastLeg = legGroup.legs[legGroup.legs.length - 1];
  const srcUrl = firstLeg?.fromMintUrl ?? '';
  const dstUrl = lastLeg?.toMintUrl ?? '';
  const srcInfo = mintInfoMap[srcUrl];
  const dstInfo = mintInfoMap[dstUrl];
  const srcName = getMintDisplayName(srcUrl, srcInfo);
  const dstName = getMintDisplayName(dstUrl, dstInfo);

  return (
    <View style={styles.collapsedRow}>
      {/* Row 1: [mint a] → [mint b] — equal width */}
      <HStack gap={8} align="center">
        <HStack gap={8} align="center" flex={1}>
          <MintIcon iconUrl={srcInfo?.icon_url} size={28} name={srcName} />
          <UntranslatedText
            bold
            size={13}
            color={withAlpha(foreground, 0.9)}
            numberOfLines={1}
            style={{ flex: 1 }}>
            {srcName}
          </UntranslatedText>
        </HStack>
        <View style={[styles.collapsedArrow, { backgroundColor: withAlpha(foreground, 0.33) }]}>
          <Icon name="mdi:arrow-right" size={10} color="#fff" />
        </View>
        <HStack gap={8} align="center" flex={1}>
          <MintIcon iconUrl={dstInfo?.icon_url} size={28} name={dstName} />
          <UntranslatedText
            bold
            size={13}
            color={withAlpha(foreground, 0.9)}
            numberOfLines={1}
            style={{ flex: 1 }}>
            {dstName}
          </UntranslatedText>
        </HStack>
      </HStack>
    </View>
  );
});
CollapsedLegGroup.displayName = 'CollapsedLegGroup';

// -----------------------------------------------------------------------
// Main screen
// -----------------------------------------------------------------------

export function SwapTransactionScreen({ groupId }: Props) {
  useLifecycleLogger('SwapTransactionScreen');
  const [foreground, muted, danger, success] = useThemeColor([
    'foreground',
    'muted',
    'danger',
    'success',
  ] as const);
  const accentColor = muted;
  const group = useSwapTransactionsStore((state) => (groupId ? state.groups[groupId] : undefined));
  const { history } = useHistoryWithMelts();
  const { getMintInfo } = useMintManagement();
  const [expanded, setExpanded] = useState(false);
  const chevronRotation = useSharedValue(0);

  const toggleExpanded = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    log.debug('tx.swap.toggle_expanded', { groupId });
    setExpanded((prev) => {
      chevronRotation.value = withTiming(prev ? 0 : 180, {
        duration: 280,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      });
      return !prev;
    });
  }, [chevronRotation, groupId]);

  const chevronAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  // Load mint info for all mint URLs used in the group (including chain URLs)
  const [mintInfoMap, setMintInfoMap] = useState<
    Record<string, { name?: string; icon_url?: string } | null>
  >({});

  const mintUrls = useMemo(() => {
    if (!group) return [];
    const urls = new Set<string>();
    for (const leg of group.legs) {
      urls.add(leg.fromMintUrl);
      urls.add(leg.toMintUrl);
      if (leg.chainPath) {
        for (const url of leg.chainPath) urls.add(url);
      }
    }
    return Array.from(urls);
  }, [group]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const map: Record<string, { name?: string; icon_url?: string } | null> = {};
      for (const url of mintUrls) {
        try {
          const info = await getMintInfo(url);
          map[url] = info ? { name: info.name, icon_url: (info as any).icon_url } : null;
        } catch {
          map[url] = null;
        }
      }
      if (mounted) setMintInfoMap(map);
    };
    if (mintUrls.length > 0) void load();
    return () => {
      mounted = false;
    };
  }, [mintUrls, getMintInfo]);

  const historyByQuoteId = useMemo(() => {
    const map = new Map<string, HistoryEntry>();
    for (const entry of history) {
      if (entry.type !== 'mint' && entry.type !== 'melt') continue;
      const quoteId = (entry as any).quoteId as string | undefined;
      if (!quoteId) continue;
      map.set(quoteId, entry);
    }
    return map;
  }, [history]);

  // Group legs by chainId for visual grouping, then filter out standalone
  // legs whose route was superseded by a middleman chain.
  const legGroups = useMemo(() => {
    if (!group) return [];
    const raw = groupLegs(group.legs);

    // Collect routes covered by a chain group
    const chainRoutes = new Set<string>();
    for (const lg of raw) {
      if (!lg.chainId || !lg.chainPath || lg.chainPath.length < 3) continue;
      const src = lg.chainPath[0];
      const dst = lg.chainPath[lg.chainPath.length - 1];
      chainRoutes.add(`${src}→${dst}`);
    }

    // Remove standalone legs whose route is covered by a chain
    return raw.filter((lg) => {
      if (lg.chainId) return true;
      const leg = lg.legs[0];
      if (!leg) return true;
      const routeKey = `${leg.fromMintUrl}→${leg.toMintUrl}`;
      return !chainRoutes.has(routeKey);
    });
  }, [group]);

  // ── Compute totals for the header and footer ──
  const { totalReceived, totalSent, totalFees, stepCount } = useMemo(() => {
    if (!group)
      return { totalReceived: 0, totalSent: 0, totalFees: 0, stepCount: 0, historyReady: false };

    let received = 0;
    let sent = 0;
    let steps = 0;
    let hasMintHistory = false;

    for (const lg of legGroups) {
      steps += lg.legs.length;
      for (const leg of lg.legs) {
        // Use actual history entry amounts where available; fall back to leg amounts
        const mintEntry = leg.mintQuoteId
          ? (historyByQuoteId.get(leg.mintQuoteId) as MintHistoryEntry | undefined)
          : undefined;
        const meltEntry = leg.meltQuoteId
          ? (historyByQuoteId.get(leg.meltQuoteId) as MeltHistoryEntry | undefined)
          : undefined;

        if (mintEntry) {
          received += Math.abs(amountToNumber(mintEntry.amount));
          hasMintHistory = true;
        }
        if (meltEntry) sent += Math.abs(amountToNumber(meltEntry.amount));
        else if (leg.amount > 0) sent += leg.amount; // fallback for synthetic melts
      }
    }

    // Don't compute fees until mint history is loaded — otherwise received=0
    // makes it look like everything was lost to fees.
    const ready = hasMintHistory || group.state === 'cancelled';

    return {
      totalReceived: received,
      totalSent: sent,
      totalFees: ready ? Math.max(0, sent - received) : 0,
      stepCount: steps,
      historyReady: ready,
    };
  }, [group, legGroups, historyByQuoteId]);

  if (!groupId || !group) {
    log.warn('tx.swap.not_found', { groupId });
    return (
      <Screen name="SwapTransactionScreen">
        <View style={styles.center}>
          <Text color={withAlpha(foreground, 0.66)}>Swap not found.</Text>
        </View>
      </Screen>
    );
  }

  log.debug('tx.swap.display', {
    groupId,
    state: group.state,
    legCount: legGroups.length,
    totalReceived,
    totalFees,
  });

  const unit = group.unit || 'sat';
  const isFailed = group.state === 'cancelled';
  const headerColor = isFailed ? danger : success;
  const fiatAmount = formatAmount(
    { amount: totalReceived || totalSent, unit },
    {
      displayAs: unit === 'usd' ? 'sats' : 'usd',
      currencyDisplay: unit === 'usd' ? 'name' : 'symbol',
    }
  );

  return (
    <TransactionDetailShell
      screenName="SwapTransactionScreen"
      testID={`swap-id-${group.id}`}
      footer={null}>
      <VStack gap={12}>
        {/* ── Header: amount + swap icon (matches HistoryEntryHeader pattern) ── */}
        <HStack align="center" justify="space-between" className="p-5 pb-0 pt-0">
          <VStack>
            <HStack align="center">
              <Spacer size={8} />
              <AmountFormatter
                amount={totalReceived || totalSent}
                unit={unit}
                size={28}
                weight="heavy"
                color={headerColor}
              />
            </HStack>
            <Text overpass size={18} color={withAlpha(foreground, 0.9)} bold>
              <Text overpass size={18} color={withAlpha(foreground, 0.9)} style={{ marginLeft: 8 }}>
                {fiatAmount}
              </Text>
            </Text>
          </VStack>

          {/* Swap icon — same style as TransactionIcon in HistoryEntryHeader */}
          <View className="scale-125 transform p-4">
            <Icon name="mdi:swap-horizontal" size={28} color={withAlpha(foreground, 0.9)} />
          </View>
        </HStack>

        {/* ── Disclosure toggle (animated chevron, like SwiftUI DisclosureGroup) ── */}
        <Pressable onPress={toggleExpanded} style={{ marginHorizontal: 16 }}>
          <HStack align="center" justify="space-between" style={styles.toggleHeader}>
            <UntranslatedText bold size={13} color={withAlpha(foreground, 0.66)}>
              Transactions
            </UntranslatedText>
            <Animated.View style={chevronAnimatedStyle}>
              <Icon
                name="material-symbols:keyboard-arrow-down-rounded"
                size={16}
                color={withAlpha(foreground, 0.5)}
              />
            </Animated.View>
          </HStack>
        </Pressable>

        {/* ── Leg cards: expanded or collapsed (Reanimated layout transition) ── */}
        <Animated.View layout={LinearTransition.duration(280)}>
          {expanded ? (
            legGroups.map((legGroup, groupIdx) => {
              const isChain = legGroup.chainId != null;

              return (
                <View key={legGroup.id} style={{ marginHorizontal: 16 }}>
                  {groupIdx > 0 ? <View style={styles.legSpacer} /> : null}

                  <TransferCard accentColor={accentColor}>
                    {/* Render each leg in the group */}
                    {legGroup.legs.map((leg, legIdx) => {
                      const mintEntry = leg.mintQuoteId
                        ? (historyByQuoteId.get(leg.mintQuoteId) as MintHistoryEntry | undefined)
                        : undefined;
                      const meltEntry = leg.meltQuoteId
                        ? (historyByQuoteId.get(leg.meltQuoteId) as MeltHistoryEntry | undefined)
                        : undefined;

                      // Synthetic MeltHistoryEntry for v3 melts missing from Coco history
                      const meltEntryForDisplay: MeltHistoryEntry | undefined =
                        meltEntry ??
                        (leg.meltQuoteId
                          ? (asHistoryEntry({
                              id: leg.meltOperationId ?? leg.id,
                              source: 'legacy',
                              legacyHistoryId: leg.meltOperationId ?? leg.id,
                              operationId: leg.meltOperationId ?? leg.id,
                              createdAt: group.createdAt,
                              updatedAt: group.createdAt,
                              mintUrl: leg.fromMintUrl,
                              unit: group.unit,
                              type: 'melt' as const,
                              quoteId: leg.meltQuoteId,
                              state:
                                leg.localStatus === 'done'
                                  ? MeltQuoteState.PAID
                                  : MeltQuoteState.UNPAID,
                              amount: leg.amount,
                            }) as MeltHistoryEntry)
                          : undefined);

                      const fromInfo = mintInfoMap[leg.fromMintUrl];
                      const toInfo = mintInfoMap[leg.toMintUrl];
                      const fromName = getMintDisplayName(leg.fromMintUrl, fromInfo);
                      const toName = getMintDisplayName(leg.toMintUrl, toInfo);
                      const hasError = leg.localStatus === 'failed';

                      // Skip the separator between chained legs when the previous
                      // leg's destination is the same mint as this leg's source
                      const prevLeg = legIdx > 0 ? legGroup.legs[legIdx - 1] : null;
                      const sameMintAsPrev =
                        prevLeg != null && prevLeg.toMintUrl === leg.fromMintUrl;

                      return (
                        <View key={leg.id}>
                          {/* Separator between chained legs (skip if same mint) */}
                          {isChain && legIdx > 0 && !sameMintAsPrev && (
                            <TransferSeparator failed={hasError} />
                          )}

                          {/* Melt row (send from source) */}
                          {meltEntryForDisplay ? (
                            <TransferEntryRow
                              {...buildSwapEntryRowProps(
                                meltEntryForDisplay,
                                fromInfo?.icon_url,
                                fromName
                              )}
                            />
                          ) : null}

                          {/* Colored separator between melt → mint */}
                          {meltEntryForDisplay && mintEntry ? (
                            <TransferSeparator failed={hasError} />
                          ) : null}

                          {/* Mint row (receive on destination) */}
                          {mintEntry ? (
                            <TransferEntryRow
                              {...buildSwapEntryRowProps(mintEntry, toInfo?.icon_url, toName)}
                            />
                          ) : null}

                          {/* Error banner */}
                          {hasError && leg.errorMessage ? (
                            <TransferErrorBanner message={leg.errorMessage} />
                          ) : null}
                        </View>
                      );
                    })}
                  </TransferCard>
                </View>
              );
            })
          ) : (
            /* ── Collapsed: compact summary per leg group ── */
            <View style={{ marginHorizontal: 16 }}>
              <TransferCard accentColor={accentColor}>
                {legGroups.map((legGroup, groupIdx) => (
                  <React.Fragment key={legGroup.id}>
                    {groupIdx > 0 && (
                      <View
                        style={{
                          height: StyleSheet.hairlineWidth,
                          backgroundColor: withAlpha(foreground, 0.1),
                          marginHorizontal: 16,
                        }}
                      />
                    )}
                    <CollapsedLegGroup legGroup={legGroup} mintInfoMap={mintInfoMap} />
                  </React.Fragment>
                ))}
              </TransferCard>
            </View>
          )}
        </Animated.View>

        {/* ── Section: metadata (below the cards, matching other screens) ── */}
        <DetailsList
          items={[
            {
              title: 'Status',
              value:
                group.state === 'finished'
                  ? 'Complete'
                  : group.state.charAt(0).toUpperCase() + group.state.slice(1),
            },
            { title: 'Steps', value: String(stepCount) },
            ...(totalFees > 0
              ? [
                  {
                    title: 'Total Fees',
                    value: `${totalFees} ${unit}`,
                  },
                ]
              : []),
            {
              title: 'Date',
              value: formatDate(group.createdAt, 'short-date-time'),
            },
          ]}
        />
      </VStack>
    </TransactionDetailShell>
  );
}

const styles = StyleSheet.create({
  toggleHeader: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  collapsedRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  collapsedArrow: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  legSpacer: {
    height: 8,
  },
  center: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
