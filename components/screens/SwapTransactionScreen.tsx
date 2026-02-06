/**
 * @fileoverview Swap Transaction Detail Screen
 *
 * Displays a grouped swap run composed of multiple steps.
 * Each step shows mint avatars with arrow overlays and a colored separator
 * derived from the destination mint's brand color.
 *
 * When legs are part of a middleman chain, they are grouped into a single card
 * with a "Middleman route: A → B → C" header showing the full routing path.
 *
 * Note: Coco's v3 `prepareMeltBolt11` → `executeMelt` flow creates the melt quote
 * inside the handler (via cashu-ts directly) and does NOT emit `melt-quote:created`,
 * so HistoryService never creates a MeltHistoryEntry for these operations.
 * For melts, we construct a synthetic MeltHistoryEntry from leg data.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import { View } from 'components/ui/View/View';
import { Text, UntranslatedText } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { ModalLayoutWrapper } from 'app/debugModal';
import { usePaginatedHistory } from 'coco-cashu-react';
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
            <UntranslatedText color={getPrimaryColor('0')} bold size={14}>
              {historyEntry.type === 'melt' ? 'Melt' : 'Mint'}
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
  const { getGreenColor, getRedColor } = useTheme();
  const color = failed ? getRedColor('400') : getGreenColor('400');

  return (
    <View style={[styles.separator, { backgroundColor: opacity(color, 0.15) }]}>
      <Icon name="mdi:arrow-down" size={14} color={color} />
    </View>
  );
});
StepSeparator.displayName = 'StepSeparator';

// -----------------------------------------------------------------------
// Sub-component: chain route header showing A → B → C
// -----------------------------------------------------------------------

interface ChainRouteHeaderProps {
  /** Full ordered path of mint URLs: [source, via1, …, destination]. */
  chainPath: string[];
  mintInfoMap: Record<string, { name?: string; icon_url?: string } | null>;
}

const ChainRouteHeader = React.memo(({ chainPath, mintInfoMap }: ChainRouteHeaderProps) => {
  const { getPrimaryColor } = useTheme();

  return (
    <View style={[styles.chainHeader, { backgroundColor: opacity(getPrimaryColor('400'), 0.1) }]}>
      <VStack spacing={6}>
        <UntranslatedText bold size={11} color={getPrimaryColor('400')}>
          Middleman route
        </UntranslatedText>
        <HStack align="center" spacing={4} style={{ flexWrap: 'wrap', rowGap: 4 }}>
          {chainPath.map((url, idx) => {
            const info = mintInfoMap[url];
            const name = info?.name || extractDomain(url);
            const isIntermediary = idx > 0 && idx < chainPath.length - 1;

            return (
              <React.Fragment key={url + idx}>
                {idx > 0 && (
                  <Icon name="mdi:chevron-right" size={14} color={getPrimaryColor('400')} />
                )}
                <HStack align="center" spacing={4} style={styles.chainMintItem}>
                  <Avatar
                    picture={info?.icon_url}
                    size={20}
                    variant="mint"
                    name={name}
                    alt={`${name} icon`}
                  />
                  <UntranslatedText
                    bold={isIntermediary}
                    size={11}
                    numberOfLines={1}
                    color={getPrimaryColor('0')}>
                    {name}
                  </UntranslatedText>
                </HStack>
              </React.Fragment>
            );
          })}
        </HStack>
      </VStack>
    </View>
  );
});
ChainRouteHeader.displayName = 'ChainRouteHeader';

// -----------------------------------------------------------------------
// Main screen
// -----------------------------------------------------------------------

export function SwapTransactionScreen({ groupId }: Props) {
  const { getPrimaryColor, getRedColor } = useTheme();
  const accentColor = useMemo(() => getPrimaryColor('300'), [getPrimaryColor]);
  const borderColor = useMemo(() => opacity(accentColor, 0.3), [accentColor]);
  const group = useSwapTransactionsStore((state) => (groupId ? state.groups[groupId] : undefined));
  const { history } = usePaginatedHistory();
  const { getMintInfo } = useMintManagement();

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

  // Group legs by chainId for visual grouping
  const legGroups = useMemo(() => {
    if (!group) return [];
    return groupLegs(group.legs);
  }, [group]);

  if (!groupId || !group) {
    return (
      <ModalLayoutWrapper>
        <View style={styles.center}>
          <Text color={getPrimaryColor('200')}>Swap not found.</Text>
        </View>
      </ModalLayoutWrapper>
    );
  }

  return (
    <ModalLayoutWrapper>
      <View style={styles.container}>
        <VStack spacing={16}>
          <Section
            style={{ marginHorizontal: 0 }}
            items={[
              { title: 'Status', value: group.state.toUpperCase() },
              { title: 'Steps', value: String(group.legs.length) },
              { title: 'Date', value: new Date(group.createdAt).toLocaleString() },
            ]}
          />

          {legGroups.map((legGroup, groupIdx) => {
            const isChain = legGroup.chainId != null;

            return (
              <View key={legGroup.id}>
                {groupIdx > 0 ? <View style={styles.legSpacer} /> : null}

                <View style={[styles.card, { borderColor }]}>
                  <BlurCardFrame accentColor={accentColor}>
                    <View style={styles.content}>
                      {/* Chain route header for middleman groups */}
                      {isChain && legGroup.chainPath && legGroup.chainPath.length >= 3 && (
                        <ChainRouteHeader
                          chainPath={legGroup.chainPath}
                          mintInfoMap={mintInfoMap}
                        />
                      )}

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

                        return (
                          <View key={leg.id}>
                            {/* Separator between chained legs */}
                            {isChain && legIdx > 0 && <StepSeparator failed={hasError} />}

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
          })}
        </VStack>
      </View>
    </ModalLayoutWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingVertical: 16,
  },
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
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
  chainHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  chainMintItem: {
    flex: 1,
    minWidth: 0,
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
