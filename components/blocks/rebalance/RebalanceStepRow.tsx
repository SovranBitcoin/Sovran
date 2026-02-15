/**
 * @fileoverview Rebalance Step Row Component
 *
 * Displays a single transfer step in the rebalance plan using the same
 * visual language as the SwapTransactionScreen expanded view:
 * - TransferCard (BlurCardFrame wrapper)
 * - TransferEntryRow for send/receive rows (avatar + badge + colored amount)
 * - TransferStepChain: horizontal timeline (Invoice → Send → Done)
 * - TransferErrorBanner for error display (only shown on failure)
 *
 * When a step is part of a middleman chain, shows the full route path
 * (A → B → C → …) with the active hop highlighted.
 */

import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { HStack } from 'components/ui/View/HStack';
import { VStack } from 'components/ui/View/VStack';
import { Avatar } from 'components/ui/Avatar';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Spinner } from 'components/ui/Spinner';
import {
  TransferCard,
  TransferEntryRow,
  TransferStepChain,
  TransferErrorBanner,
} from 'components/ui/TransferLegCard';
import Icon from 'assets/icons';

export type StepStatus =
  | 'pending'
  | 'creatingInvoice'
  | 'invoiceReady'
  | 'melting'
  | 'verifying'
  | 'routing'
  | 'done'
  | 'failed'
  | 'skipped';

interface MintInfo {
  name?: string;
  icon_url?: string;
}

interface ChainInfo {
  chainId: string;
  /** Full ordered path of mint URLs: [source, via1, …, destination]. */
  chainPath: string[];
  /** 0-based index of the current hop within the chain. */
  chainHopIndex: number;
  /** Mint info for each URL in chainPath (parallel array). */
  pathMintInfos: (MintInfo | null)[];
}

interface RebalanceStepRowProps {
  /** Step ID */
  id: string;
  /** Source mint URL */
  fromMintUrl: string;
  /** Source mint info */
  fromMintInfo?: MintInfo | null;
  /** Destination mint URL */
  toMintUrl: string;
  /** Destination mint info */
  toMintInfo?: MintInfo | null;
  /** Amount to transfer */
  amount: number;
  /** Unit for display */
  unit: string;
  /** Current step status */
  status: StepStatus;
  /** Error message if failed */
  errorMessage?: string;
  /** Route suggestion if we can propose an intermediary (no_route helper) */
  routeSuggestion?: {
    status: 'searching' | 'found' | 'none';
    path?: string[];
    pathNames?: string[];
  };
  /** Called when route-through action is pressed */
  onRouteThrough?: () => void;
  /** Called when retry is pressed (fallback) */
  onRetry?: () => void;
  /** Called when skip is pressed */
  onSkip?: () => void;
  /** Step number for display */
  stepNumber: number;
  /** Whether this is the current step (highlighted) */
  isCurrent?: boolean;
  /** Chain info when this step is part of a middleman route */
  chainInfo?: ChainInfo;
  /** Sub-status detail during auto-routing (e.g. "Hop 1/2: Sending…") */
  routingDetail?: string;
  /** Chain path being auto-routed through (shown during routing) */
  routingChainPath?: string[];
  /** Human-readable names for routingChainPath */
  routingChainPathNames?: string[];
  /** Current hop index during auto-routing */
  routingHopIndex?: number;
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function mintDisplayName(info: MintInfo | null | undefined, url: string): string {
  return info?.name || extractDomain(url);
}

export const RebalanceStepRow: React.FC<RebalanceStepRowProps> = ({
  fromMintUrl,
  fromMintInfo,
  toMintUrl,
  toMintInfo,
  amount,
  unit,
  status,
  errorMessage,
  routeSuggestion,
  onRouteThrough,
  onRetry,
  onSkip,
  // stepNumber, isCurrent — kept in interface for API compat but no longer used
  chainInfo,
  routingDetail,
  routingChainPath,
  routingChainPathNames,
  routingHopIndex,
}) => {
  const { getPrimaryColor } = useTheme();
  const primaryColor0 = useMemo(() => getPrimaryColor('0'), [getPrimaryColor]);
  const primaryColor300 = useMemo(() => opacity(getPrimaryColor('0'), 0.5), [getPrimaryColor]);
  const primaryColor400 = useMemo(() => opacity(getPrimaryColor('0'), 0.4), [getPrimaryColor]);
  const primaryColor700 = useMemo(() => getPrimaryColor('700'), [getPrimaryColor]);

  const fromName = fromMintInfo?.name || extractDomain(fromMintUrl);
  const toName = toMintInfo?.name || extractDomain(toMintUrl);

  const isDone = status === 'done';
  const isFailed = status === 'failed';
  const isRouting = status === 'routing';

  // Build the "via X" subtitle for the retry button
  const routeViaLabel = useMemo(() => {
    if (!routeSuggestion?.path || routeSuggestion.path.length < 3) return null;
    const intermediaries = routeSuggestion.path.slice(1, -1);
    const names = routeSuggestion.pathNames?.slice(1, -1) ?? intermediaries.map(extractDomain);
    return names.join(' → ');
  }, [routeSuggestion]);

  const totalHops = chainInfo ? chainInfo.chainPath.length - 1 : 0;

  return (
    <View style={[styles.outerContainer, isDone && { opacity: 0.85 }]}>
      <TransferCard>
        {/* Middleman chain route: A → B → C → … */}
        {chainInfo ? (
          <VStack gap={6} style={styles.chainSection}>
            <Text size={11} bold overpass style={{ color: primaryColor400 }}>
              Middleman route
            </Text>
            <HStack align="center" gap={4} style={{ flexWrap: 'wrap', rowGap: 4 }}>
              {chainInfo.chainPath.map((url, idx) => {
                const info = chainInfo.pathMintInfos[idx];
                const name = mintDisplayName(info, url);
                const isActiveNode =
                  idx === chainInfo.chainHopIndex || idx === chainInfo.chainHopIndex + 1;
                const isIntermediary = idx > 0 && idx < chainInfo.chainPath.length - 1;

                return (
                  <React.Fragment key={url + idx}>
                    {idx > 0 && (
                      <Icon
                        name="mdi:chevron-right"
                        size={14}
                        color={
                          idx === chainInfo.chainHopIndex + 1 ? primaryColor0 : primaryColor400
                        }
                      />
                    )}
                    <HStack
                      align="center"
                      gap={3}
                      style={[
                        styles.chainMintSection,
                        !isActiveNode && styles.chainDimmed,
                        { flexShrink: 1 },
                      ]}>
                      <Avatar
                        picture={info?.icon_url}
                        size={20}
                        variant="mint"
                        name={name}
                        alt={`${name} icon`}
                      />
                      <Text
                        size={10}
                        numberOfLines={1}
                        bold={isIntermediary}
                        style={[styles.mintName, { color: primaryColor0 }]}>
                        {name}
                      </Text>
                    </HStack>
                  </React.Fragment>
                );
              })}
            </HStack>
            <Text size={10} style={{ color: primaryColor400 }}>
              Leg {chainInfo.chainHopIndex + 1} of {totalHops} — {fromName} → {toName}
            </Text>
          </VStack>
        ) : null}

        {/* Auto-routing chain path (shown during or after routing) */}
        {isRouting && routingChainPath && routingChainPath.length >= 3 && (
          <VStack gap={4} style={styles.routingSection}>
            <HStack align="center" gap={4} style={{ flexWrap: 'wrap', rowGap: 4 }}>
              {routingChainPath.map((url, idx) => {
                const name = routingChainPathNames?.[idx] || extractDomain(url);
                const isActiveNode =
                  routingHopIndex != null &&
                  (idx === routingHopIndex || idx === routingHopIndex + 1);
                const isIntermediary = idx > 0 && idx < routingChainPath.length - 1;

                return (
                  <React.Fragment key={url + idx}>
                    {idx > 0 && (
                      <Icon
                        name="mdi:chevron-right"
                        size={14}
                        color={
                          routingHopIndex != null && idx === routingHopIndex + 1
                            ? '#c084fc'
                            : primaryColor400
                        }
                      />
                    )}
                    <HStack
                      align="center"
                      gap={3}
                      style={[
                        styles.chainMintSection,
                        routingHopIndex != null && !isActiveNode && styles.chainDimmed,
                        { flexShrink: 1 },
                      ]}>
                      <Avatar
                        picture={undefined}
                        size={18}
                        variant="mint"
                        name={name}
                        alt={`${name} icon`}
                      />
                      <Text
                        size={10}
                        numberOfLines={1}
                        bold={isIntermediary}
                        style={{ color: isActiveNode ? '#c084fc' : primaryColor0 }}>
                        {name}
                      </Text>
                    </HStack>
                  </React.Fragment>
                );
              })}
            </HStack>
            {routingHopIndex != null && (
              <Text size={10} style={{ color: '#c084fc' }}>
                Hop {routingHopIndex + 1} of {routingChainPath.length - 1}
              </Text>
            )}
          </VStack>
        )}

        {/* Send row (from source mint) */}
        <TransferEntryRow
          type="send"
          mintIconUrl={fromMintInfo?.icon_url}
          mintName={fromName}
          amount={amount}
          unit={unit}
        />

        {/* Step chain: ● Invoice ── ● Send ── ● Done */}
        <TransferStepChain status={status} routingDetail={routingDetail} />

        {/* Receive row (to destination mint) */}
        <TransferEntryRow
          type="receive"
          mintIconUrl={toMintInfo?.icon_url}
          mintName={toName}
          amount={amount}
          unit={unit}
        />

        {/* Error banner and actions */}
        {isFailed && errorMessage && (
          <VStack gap={8} style={styles.errorSection}>
            <TransferErrorBanner message={errorMessage} />

            {String(errorMessage).includes('no_route') &&
              routeSuggestion?.status === 'searching' && (
                <HStack align="center" gap={8} style={styles.errorActionRow}>
                  <Spinner size={14} />
                  <Text size={12} style={{ color: primaryColor300 }}>
                    Finding a middleman…
                  </Text>
                </HStack>
              )}
            {String(errorMessage).includes('no_route') && routeSuggestion?.status === 'none' && (
              <Text size={12} style={{ color: primaryColor300, paddingHorizontal: 16 }}>
                No middleman routes available right now.
              </Text>
            )}
            <HStack gap={8} style={styles.errorActionRow}>
              {routeSuggestion?.status === 'found' && routeSuggestion?.path && onRouteThrough ? (
                <TouchableOpacity
                  onPress={onRouteThrough}
                  haptics
                  style={[styles.actionButton, { backgroundColor: primaryColor700 }]}>
                  <VStack gap={2}>
                    <HStack align="center" gap={4}>
                      <Icon name="mdi:swap-horizontal" size={14} color={primaryColor0} />
                      <Text bold overpass size={12} style={{ color: primaryColor0 }}>
                        Retry through middleman
                      </Text>
                    </HStack>
                    {routeViaLabel && (
                      <Text size={10} style={{ color: primaryColor400, paddingLeft: 18 }}>
                        via {routeViaLabel}
                      </Text>
                    )}
                  </VStack>
                </TouchableOpacity>
              ) : onRetry ? (
                <TouchableOpacity
                  onPress={onRetry}
                  haptics
                  style={[styles.actionButton, { backgroundColor: primaryColor700 }]}>
                  <HStack align="center" gap={4}>
                    <Icon name="mdi:refresh" size={14} color={primaryColor0} />
                    <Text bold overpass size={12} style={{ color: primaryColor0 }}>
                      Retry
                    </Text>
                  </HStack>
                </TouchableOpacity>
              ) : null}
              {onSkip && (
                <TouchableOpacity
                  onPress={onSkip}
                  haptics
                  style={[styles.actionButton, { backgroundColor: primaryColor700 }]}>
                  <HStack align="center" gap={4}>
                    <Icon name="mdi:skip-next" size={14} color={primaryColor0} />
                    <Text bold overpass size={12} style={{ color: primaryColor0 }}>
                      Skip
                    </Text>
                  </HStack>
                </TouchableOpacity>
              )}
            </HStack>
          </VStack>
        )}
      </TransferCard>
    </View>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    marginHorizontal: 16,
    marginVertical: 6,
  },
  chainSection: {
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  routingSection: {
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  chainMintSection: {
    minWidth: 0,
  },
  chainDimmed: {
    opacity: 0.4,
  },
  mintName: {
    flex: 1,
  },
  errorSection: {
    paddingBottom: 12,
  },
  errorActionRow: {
    paddingHorizontal: 16,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
});
