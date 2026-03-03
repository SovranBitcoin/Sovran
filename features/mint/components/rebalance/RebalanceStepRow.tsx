/**
 * @fileoverview Rebalance Step Row Component
 *
 * Displays a single transfer step in the rebalance plan using the same
 * visual language as the SwapTransactionScreen expanded view:
 * - TransferCard (BlurCardFrame wrapper)
 * - TransferEntryRow for send/receive rows (avatar + badge + colored amount)
 * - TransferStepChain: horizontal timeline (Invoice → Swap → Done)
 * - TransferErrorBanner for error display (only shown on failure)
 *
 * When a step is part of a middleman chain, shows the full route path
 * (A → B → C → …) with the active hop highlighted.
 */

import React, { useMemo } from 'react';
import opacity from 'hex-color-opacity';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import {
  TransferCard,
  TransferEntryRow,
  TransferStepChain,
  TransferErrorBanner,
} from '@/shared/ui/transfer';
import Icon from 'assets/icons';
import { extractDomain, getMintDisplayName } from '@/shared/lib/url';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

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
  /** Chain info when this step is part of a middleman route */
  chainInfo?: ChainInfo;
  /** Sub-status detail during auto-routing (e.g. "Hop 1/2: Sending…") */
  routingDetail?: string;
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
  chainInfo,
  routingDetail,
}) => {
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);
  const primaryColor0 = foreground;
  const primaryColor300 = useMemo(() => opacity(foreground, 0.5), [foreground]);
  const primaryColor400 = useMemo(() => opacity(foreground, 0.4), [foreground]);
  const primaryColor700 = surfaceTertiary;

  const fromName = getMintDisplayName(fromMintUrl, fromMintInfo);
  const toName = getMintDisplayName(toMintUrl, toMintInfo);

  const isDone = status === 'done';
  const isFailed = status === 'failed';

  const routeViaLabel = useMemo(() => {
    if (!routeSuggestion?.path || routeSuggestion.path.length < 3) return null;
    const intermediaries = routeSuggestion.path.slice(1, -1);
    const names = routeSuggestion.pathNames?.slice(1, -1) ?? intermediaries.map(extractDomain);
    return names.join(' → ');
  }, [routeSuggestion]);

  const totalHops = chainInfo ? chainInfo.chainPath.length - 1 : 0;

  return (
    <View className="mx-4 my-1.5" style={isDone ? { opacity: 0.85 } : undefined}>
      <TransferCard>
        {chainInfo ? (
          <VStack gap={6} className="px-4 pt-4">
            <Text size={11} bold style={{ color: primaryColor400 }}>
              Middleman route
            </Text>
            <HStack align="center" gap={4} className="flex-wrap gap-y-1">
              {chainInfo.chainPath.map((url, idx) => {
                const info = chainInfo.pathMintInfos[idx];
                const name = getMintDisplayName(url, info);
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
                      className={`min-w-0 shrink ${!isActiveNode ? 'opacity-40' : ''}`}>
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
                        className="flex-1"
                        style={{ color: primaryColor0 }}>
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

        <TransferEntryRow
          type="send"
          mintIconUrl={fromMintInfo?.icon_url}
          mintName={fromName}
          amount={amount}
          unit={unit}
        />

        <TransferStepChain
          status={status}
          routingDetail={routingDetail}
          middleLabel={chainInfo ? 'Swap' : 'Send'}
        />

        <TransferEntryRow
          type="receive"
          mintIconUrl={toMintInfo?.icon_url}
          mintName={toName}
          amount={amount}
          unit={unit}
        />

        {isFailed && errorMessage && (
          <VStack gap={8} className="pb-3">
            <TransferErrorBanner message={errorMessage} />

            {String(errorMessage).includes('no_route') &&
              routeSuggestion?.status === 'searching' && (
                <HStack align="center" gap={8} className="px-4">
                  <Spinner size={14} />
                  <Text size={12} style={{ color: primaryColor300 }}>
                    Finding a middleman…
                  </Text>
                </HStack>
              )}
            {String(errorMessage).includes('no_route') && routeSuggestion?.status === 'none' && (
              <Text size={12} className="px-4" style={{ color: primaryColor300 }}>
                No middleman routes available right now.
              </Text>
            )}
            <HStack gap={8} className="px-4">
              {routeSuggestion?.status === 'found' && routeSuggestion?.path && onRouteThrough ? (
                <TouchableOpacity
                  onPress={onRouteThrough}
                  haptics
                  style={{
                    backgroundColor: primaryColor700,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 6,
                  }}>
                  <VStack gap={2}>
                    <HStack align="center" gap={4}>
                      <Icon name="mdi:swap-horizontal" size={14} color={primaryColor0} />
                      <Text bold size={12} className="text-foreground">
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
                  style={{
                    backgroundColor: primaryColor700,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 6,
                  }}>
                  <HStack align="center" gap={4}>
                    <Icon name="mdi:refresh" size={14} color={primaryColor0} />
                    <Text bold size={12} className="text-foreground">
                      Retry
                    </Text>
                  </HStack>
                </TouchableOpacity>
              ) : null}
              {onSkip && (
                <TouchableOpacity
                  onPress={onSkip}
                  haptics
                  style={{
                    backgroundColor: primaryColor700,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 6,
                  }}>
                  <HStack align="center" gap={4}>
                    <Icon name="mdi:skip-next" size={14} color={primaryColor0} />
                    <Text bold size={12} className="text-foreground">
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
