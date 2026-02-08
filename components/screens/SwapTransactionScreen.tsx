/**
 * @fileoverview Swap Transaction Detail Screen
 *
 * Displays a grouped swap run composed of multiple steps.
 * Layout follows the same pattern as MeltQuote / MintQuote / SendToken screens:
 *   1. Header with total amount + swap icon
 *   2. Leg cards
 *   3. Section with metadata (Status, Steps, Fees, Date)
 *
 * When legs are part of a middleman chain, they are grouped into a single card.
 * Failed direct legs are hidden when a successful chain covers the same route.
 * Consecutive entries on the same mint omit the redundant arrow separator.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutAnimation, Platform, StyleSheet, UIManager } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import { View } from 'components/ui/View/View';
import { Text, UntranslatedText } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { Spacer } from 'components/ui/View/Spacer';
import { ModalLayoutWrapper } from 'app/debugModal';
import { useHistoryWithMelts } from 'hooks/coco/useHistoryWithMelts';
import type { HistoryEntry, MeltHistoryEntry, MintHistoryEntry } from 'coco-cashu-core';
import { useSwapTransactionsStore, type SwapLeg } from 'stores/swapTransactionsStore';
import opacity from 'hex-color-opacity';
import { BlurCardFrame } from 'components/ui/BlurCardFrame';
import { Section } from 'components/ui/Section';
import { Avatar } from 'components/ui/Avatar';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { convertTime } from 'helper/time';
import { formatAmount } from 'helper/currency';
import { useMintManagement } from 'hooks/coco/useMintManagement';
import Icon from 'assets/icons';
import { router } from 'expo-router';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Props {
  groupId: string | undefined;
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

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
// Sub-component: a single transaction row with a mint Avatar + arrow badge
// -----------------------------------------------------------------------

interface SwapEntryRowProps {
  historyEntry: MintHistoryEntry | MeltHistoryEntry;
  mintIconUrl: string | undefined;
  mintName: string;
}

const SwapEntryRow = React.memo(({ historyEntry, mintIconUrl, mintName }: SwapEntryRowProps) => {
  const { getPrimaryColor, getRedColor, getGreenColor } = useTheme();

  const isSend = historyEntry.type === 'melt';
  const fiatAmount = formatAmount(
    { amount: Math.abs(historyEntry.amount), unit: historyEntry.unit },
    { displayAs: 'usd' }
  );

  const handlePress = () => {
    if (historyEntry.type === 'mint') {
      router.navigate({
        pathname: '/mintQuote',
        params: { mintHistoryEntry: JSON.stringify(historyEntry) },
      });
    } else {
      router.navigate({
        pathname: '/meltQuote',
        params: { meltHistoryEntry: JSON.stringify(historyEntry) },
      });
    }
  };

  return (
    <TouchableOpacity style={styles.entryRow} onPress={handlePress}>
      <HStack spacing={12} flex={1}>
        {/* Avatar with small arrow overlay */}
        <View style={styles.avatarWrapper}>
          <Avatar picture={mintIconUrl} size={36} variant="mint" name={mintName} />
          <View style={[styles.arrowBadge, { backgroundColor: getPrimaryColor('500') }]}>
            <Icon
              name={isSend ? 'fluent:arrow-upload-16-filled' : 'fluent:arrow-download-16-filled'}
              size={10}
              color="#fff"
            />
          </View>
        </View>

        <VStack spacing={0} flex={1}>
          <HStack justify="space-between" align="flex-end">
            <UntranslatedText color={getPrimaryColor('0')} bold size={14} numberOfLines={1}>
              {mintName}
            </UntranslatedText>
            <HStack align="center" spacing={0}>
              <UntranslatedText
                color={isSend ? getRedColor('300') : getGreenColor('300')}
                bold
                size={16}>
                {isSend ? '- ' : '+ '}
              </UntranslatedText>
              <AmountFormatter
                amount={historyEntry.amount}
                unit={historyEntry.unit}
                size={16}
                weight="heavy"
                color={isSend ? getRedColor('300') : getGreenColor('300')}
              />
            </HStack>
          </HStack>

          <HStack justify="space-between" align="center">
            <UntranslatedText regular size={10} color={getPrimaryColor('100')}>
              {historyEntry.createdAt
                ? convertTime(new Date(historyEntry.createdAt))
                : 'Unconfirmed'}
            </UntranslatedText>
            <UntranslatedText bold size={10} color={getPrimaryColor('100')}>
              {fiatAmount}
            </UntranslatedText>
          </HStack>
        </VStack>
      </HStack>
    </TouchableOpacity>
  );
});
SwapEntryRow.displayName = 'SwapEntryRow';

// -----------------------------------------------------------------------
// Sub-component: colored separator between melt → mint
// -----------------------------------------------------------------------

interface StepSeparatorProps {
  failed: boolean;
}

const StepSeparator = React.memo(({ failed }: StepSeparatorProps) => {
  const { getPrimaryColor, getRedColor } = useTheme();
  const bgColor = failed ? getRedColor('500') : getPrimaryColor('500');

  return (
    <View style={[styles.separator, { backgroundColor: bgColor }]}>
      <Icon name="mdi:arrow-down" size={14} color="#fff" />
    </View>
  );
});
StepSeparator.displayName = 'StepSeparator';

// -----------------------------------------------------------------------
// Sub-component: compact collapsed row for a leg group
// -----------------------------------------------------------------------

interface CollapsedLegGroupProps {
  legGroup: LegGroup;
  mintInfoMap: Record<string, { name?: string; icon_url?: string } | null>;
}

const CollapsedLegGroup = React.memo(({ legGroup, mintInfoMap }: CollapsedLegGroupProps) => {
  const { getPrimaryColor } = useTheme();

  // Source = first leg's from, Destination = last leg's to
  const firstLeg = legGroup.legs[0];
  const lastLeg = legGroup.legs[legGroup.legs.length - 1];
  const srcUrl = firstLeg?.fromMintUrl ?? '';
  const dstUrl = lastLeg?.toMintUrl ?? '';
  const srcInfo = mintInfoMap[srcUrl];
  const dstInfo = mintInfoMap[dstUrl];
  const srcName = srcInfo?.name || extractDomain(srcUrl);
  const dstName = dstInfo?.name || extractDomain(dstUrl);

  return (
    <View style={styles.collapsedRow}>
      {/* Row 1: [mint a] → [mint b] — equal width */}
      <HStack spacing={8} align="center">
        <HStack spacing={8} align="center" flex={1}>
          <Avatar picture={srcInfo?.icon_url} size={28} variant="mint" name={srcName} />
          <UntranslatedText
            bold
            size={13}
            color={getPrimaryColor('50')}
            numberOfLines={1}
            style={{ flex: 1 }}>
            {srcName}
          </UntranslatedText>
        </HStack>
        <View style={[styles.collapsedArrow, { backgroundColor: getPrimaryColor('500') }]}>
          <Icon name="mdi:arrow-right" size={10} color="#fff" />
        </View>
        <HStack spacing={8} align="center" flex={1}>
          <Avatar picture={dstInfo?.icon_url} size={28} variant="mint" name={dstName} />
          <UntranslatedText
            bold
            size={13}
            color={getPrimaryColor('50')}
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
  const { getPrimaryColor, getGreenColor, getRedColor } = useTheme();
  const accentColor = useMemo(() => getPrimaryColor('300'), [getPrimaryColor]);
  const borderColor = useMemo(() => opacity(accentColor, 0.3), [accentColor]);
  const group = useSwapTransactionsStore((state) => (groupId ? state.groups[groupId] : undefined));
  const { history } = useHistoryWithMelts();
  const { getMintInfo } = useMintManagement();
  const [expanded, setExpanded] = useState(false);

  const toggleExpanded = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  }, []);

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
    if (mintUrls.length > 0) load();
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
    if (!group) return { totalReceived: 0, totalSent: 0, totalFees: 0, stepCount: 0 };

    let received = 0;
    let sent = 0;
    let steps = 0;

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

        if (mintEntry) received += Math.abs(mintEntry.amount);
        if (meltEntry) sent += Math.abs(meltEntry.amount);
        else if (leg.amount > 0) sent += leg.amount; // fallback for synthetic melts
      }
    }

    return {
      totalReceived: received,
      totalSent: sent,
      totalFees: Math.max(0, sent - received),
      stepCount: steps,
    };
  }, [group, legGroups, historyByQuoteId]);

  if (!groupId || !group) {
    return (
      <ModalLayoutWrapper>
        <View style={styles.center}>
          <Text color={getPrimaryColor('200')}>Swap not found.</Text>
        </View>
      </ModalLayoutWrapper>
    );
  }

  const unit = group.unit || 'sat';
  const isFailed = group.state === 'cancelled';
  const headerColor = isFailed ? getRedColor('300') : getGreenColor('300');
  const fiatAmount = formatAmount(
    { amount: totalReceived || totalSent, unit },
    {
      displayAs: unit === 'usd' ? 'sats' : 'usd',
      currencyDisplay: unit === 'usd' ? 'name' : 'symbol',
    }
  );

  return (
    <ModalLayoutWrapper contentPadding={0}>
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
            <Text size={18} color={getPrimaryColor('50')} bold>
              <Text size={18} color={getPrimaryColor('50')} style={{ marginLeft: 8 }}>
                {fiatAmount}
              </Text>
            </Text>
          </VStack>

          {/* Swap icon — same style as TransactionIcon in HistoryEntryHeader */}
          <View className="scale-125 transform bg-transparent p-4">
            <Icon name="mdi:swap-horizontal" size={28} color={getPrimaryColor('50')} />
          </View>
        </HStack>

        {/* ── Toggle header ── */}
        <TouchableOpacity onPress={toggleExpanded} style={{ marginHorizontal: 16 }}>
          <HStack align="center" justify="space-between" style={styles.toggleHeader}>
            <UntranslatedText bold size={13} color={getPrimaryColor('200')}>
              Transactions
            </UntranslatedText>
            <Icon
              name={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
              size={18}
              color={getPrimaryColor('300')}
            />
          </HStack>
        </TouchableOpacity>

        {/* ── Leg cards: expanded or collapsed ── */}
        {expanded ? (
          legGroups.map((legGroup, groupIdx) => {
            const isChain = legGroup.chainId != null;

            return (
              <View key={legGroup.id} style={{ marginHorizontal: 16 }}>
                {groupIdx > 0 ? <View style={styles.legSpacer} /> : null}

                <View style={[styles.card, { borderColor }]}>
                  <BlurCardFrame accentColor={accentColor}>
                    <View style={styles.content}>
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
                            ? {
                                id: leg.meltOperationId ?? leg.id,
                                createdAt: group.createdAt,
                                mintUrl: leg.fromMintUrl,
                                unit: group.unit,
                                type: 'melt' as const,
                                quoteId: leg.meltQuoteId,
                                state: leg.localStatus === 'done' ? 'PAID' : 'UNPAID',
                                amount: leg.amount,
                              }
                            : undefined);

                        const fromInfo = mintInfoMap[leg.fromMintUrl];
                        const toInfo = mintInfoMap[leg.toMintUrl];
                        const fromName = fromInfo?.name || extractDomain(leg.fromMintUrl);
                        const toName = toInfo?.name || extractDomain(leg.toMintUrl);
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
                              <StepSeparator failed={hasError} />
                            )}

                            {/* Melt row (send from source) */}
                            {meltEntryForDisplay ? (
                              <SwapEntryRow
                                historyEntry={meltEntryForDisplay}
                                mintIconUrl={fromInfo?.icon_url}
                                mintName={fromName}
                              />
                            ) : null}

                            {/* Colored separator between melt → mint */}
                            {meltEntryForDisplay && mintEntry ? (
                              <StepSeparator failed={hasError} />
                            ) : null}

                            {/* Mint row (receive on destination) */}
                            {mintEntry ? (
                              <SwapEntryRow
                                historyEntry={mintEntry}
                                mintIconUrl={toInfo?.icon_url}
                                mintName={toName}
                              />
                            ) : null}

                            {/* Error banner */}
                            {hasError && leg.errorMessage ? (
                              <View
                                style={[
                                  styles.errorBanner,
                                  { backgroundColor: opacity(getRedColor('400'), 0.15) },
                                ]}>
                                <HStack spacing={8} align="center">
                                  <Icon
                                    name="mdi:alert-circle"
                                    size={16}
                                    color={getRedColor('400')}
                                  />
                                  <UntranslatedText
                                    size={11}
                                    bold
                                    color={getRedColor('400')}
                                    style={{ flex: 1 }}>
                                    {leg.errorMessage}
                                  </UntranslatedText>
                                </HStack>
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  </BlurCardFrame>
                </View>
              </View>
            );
          })
        ) : (
          /* ── Collapsed: compact summary per leg group ── */
          <View style={{ marginHorizontal: 16 }}>
            <View style={[styles.card, { borderColor }]}>
              <BlurCardFrame accentColor={accentColor}>
                <View style={styles.content}>
                  {legGroups.map((legGroup, groupIdx) => (
                    <React.Fragment key={legGroup.id}>
                      {groupIdx > 0 && (
                        <View
                          style={{
                            height: StyleSheet.hairlineWidth,
                            backgroundColor: opacity(getPrimaryColor('400'), 0.2),
                            marginHorizontal: 16,
                          }}
                        />
                      )}
                      <CollapsedLegGroup legGroup={legGroup} mintInfoMap={mintInfoMap} />
                    </React.Fragment>
                  ))}
                </View>
              </BlurCardFrame>
            </View>
          </View>
        )}

        {/* ── Section: metadata (below the cards, matching other screens) ── */}
        <Section
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
              value: convertTime(new Date(group.createdAt)),
            },
          ]}
        />
      </VStack>
    </ModalLayoutWrapper>
  );
}

const styles = StyleSheet.create({
  toggleHeader: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
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
  content: {
    zIndex: 1,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    padding: 20,
    paddingLeft: 16,
    paddingRight: 16,
  },
  avatarWrapper: {
    position: 'relative',
    width: 36,
    height: 36,
  },
  arrowBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  separator: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 24,
    marginHorizontal: 16,
    borderRadius: 6,
  },
  errorBanner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 6,
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
