/**
 * @fileoverview Rebalance Step Row Component
 *
 * Displays a single transfer step in the rebalance plan:
 * - From mint avatar/name → To mint avatar/name
 * - Amount being transferred
 * - Status indicator (pending, running, done, failed)
 * - Retry/Skip actions on failure
 */

import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { HStack } from 'components/ui/View/HStack';
import { VStack } from 'components/ui/View/VStack';
import { Avatar } from 'components/ui/Avatar';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { Spinner } from 'components/ui/Spinner';
import Icon from 'assets/icons';

export type StepStatus =
  | 'pending'
  | 'creatingInvoice'
  | 'invoiceReady'
  | 'melting'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'skipped';

interface MintInfo {
  name?: string;
  icon_url?: string;
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
    viaMintUrl?: string;
    viaMintName?: string;
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
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
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
  stepNumber,
  isCurrent,
}) => {
  const { getPrimaryColor, getGreenColor } = useTheme();
  const primaryColor0 = useMemo(() => getPrimaryColor('0'), [getPrimaryColor]);
  const primaryColor300 = useMemo(() => getPrimaryColor('300'), [getPrimaryColor]);
  const primaryColor400 = useMemo(() => getPrimaryColor('400'), [getPrimaryColor]);
  const primaryColor700 = useMemo(() => getPrimaryColor('700'), [getPrimaryColor]);
  const primaryColor800 = useMemo(() => getPrimaryColor('800'), [getPrimaryColor]);
  const greenColor = useMemo(() => getGreenColor('400'), [getGreenColor]);
  const redColor = '#ef4444'; // red-500

  const fromName = fromMintInfo?.name || extractDomain(fromMintUrl);
  const toName = toMintInfo?.name || extractDomain(toMintUrl);

  const isRunning =
    status === 'creatingInvoice' ||
    status === 'invoiceReady' ||
    status === 'melting' ||
    status === 'verifying';
  const isDone = status === 'done';
  const isFailed = status === 'failed';
  const isSkipped = status === 'skipped';

  const statusColor = isDone
    ? greenColor
    : isFailed
      ? redColor
      : isSkipped
        ? primaryColor400
        : primaryColor300;

  const getStatusText = () => {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'creatingInvoice':
        return 'Creating invoice...';
      case 'invoiceReady':
        return 'Invoice ready';
      case 'melting':
        return 'Sending...';
      case 'verifying':
        return 'Verifying...';
      case 'done':
        return 'Complete';
      case 'failed':
        return 'Failed';
      case 'skipped':
        return 'Skipped';
      default:
        return '';
    }
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: primaryColor800, borderColor: primaryColor700 },
        isCurrent && { borderColor: primaryColor0 },
        isDone && { opacity: 0.85 },
      ]}>
      {/* Step number badge - shows checkmark when done */}
      <View
        style={[
          styles.stepBadge,
          { backgroundColor: isDone ? greenColor : isFailed ? redColor : primaryColor700 },
        ]}>
        {isDone ? (
          <Icon name="mdi:check" size={14} color={primaryColor800} />
        ) : isRunning ? (
          <Spinner size={12} style={{ opacity: 0.8 }} />
        ) : isFailed ? (
          <Icon name="mdi:alert-circle" size={14} color={primaryColor0} />
        ) : (
          <Text bold overpass size={12} style={{ color: primaryColor0 }}>
            {stepNumber}
          </Text>
        )}
      </View>

      {/* Main content */}
      <VStack gap={12} style={styles.content}>
        {/* From → To row */}
        <HStack align="center" gap={8}>
          {/* From mint */}
          <HStack align="center" gap={8} style={styles.mintSection}>
            <Avatar
              picture={fromMintInfo?.icon_url}
              size={32}
              variant="mint"
              name={fromName}
              alt={`${fromName} icon`}
            />
            <Text size={13} numberOfLines={1} style={[styles.mintName, { color: primaryColor0 }]}>
              {fromName}
            </Text>
          </HStack>

          {/* Arrow */}
          <Icon name="mdi:arrow-right" size={20} color={primaryColor400} />

          {/* To mint */}
          <HStack align="center" gap={8} style={styles.mintSection}>
            <Avatar
              picture={toMintInfo?.icon_url}
              size={32}
              variant="mint"
              name={toName}
              alt={`${toName} icon`}
            />
            <Text size={13} numberOfLines={1} style={[styles.mintName, { color: primaryColor0 }]}>
              {toName}
            </Text>
          </HStack>
        </HStack>

        {/* Amount and status row */}
        <HStack align="center" justify="space-between">
          <AmountFormatter
            amount={amount}
            unit={unit}
            size={16}
            weight="heavy"
            color={primaryColor0}
          />

          <HStack align="center" gap={6}>
            {isRunning && <Spinner size={16} />}
            {isDone && <Icon name="mdi:check-circle" size={18} color={greenColor} />}
            {isFailed && <Icon name="mdi:alert-circle" size={18} color={redColor} />}
            {isSkipped && <Icon name="mdi:skip-next-circle" size={18} color={primaryColor400} />}
            <Text size={12} bold={isDone} style={{ color: statusColor }}>
              {getStatusText()}
            </Text>
          </HStack>
        </HStack>

        {/* Error message and actions */}
        {isFailed && errorMessage && (
          <VStack gap={8}>
            <Text size={12} style={{ color: redColor }}>
              {errorMessage}
            </Text>
            {String(errorMessage).includes('no_route') &&
              routeSuggestion?.status === 'searching' && (
                <HStack align="center" gap={8}>
                  <Spinner size={14} />
                  <Text size={12} style={{ color: primaryColor300 }}>
                    Finding a route…
                  </Text>
                </HStack>
              )}
            {String(errorMessage).includes('no_route') && routeSuggestion?.status === 'none' && (
              <Text size={12} style={{ color: primaryColor300 }}>
                No route suggestions available right now.
              </Text>
            )}
            <HStack gap={8}>
              {routeSuggestion?.status === 'found' &&
              routeSuggestion?.viaMintUrl &&
              onRouteThrough ? (
                <TouchableOpacity
                  onPress={onRouteThrough}
                  haptics
                  style={[styles.actionButton, { backgroundColor: primaryColor700 }]}>
                  <HStack align="center" gap={4}>
                    <Icon name="mdi:swap-horizontal" size={14} color={primaryColor0} />
                    <Text bold overpass size={12} style={{ color: primaryColor0 }}>
                      Route through{' '}
                      {routeSuggestion.viaMintName || extractDomain(routeSuggestion.viaMintUrl)}
                    </Text>
                  </HStack>
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
      </VStack>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 4,
  },
  content: {
    flex: 1,
  },
  mintSection: {
    flex: 1,
    minWidth: 0,
  },
  mintName: {
    flex: 1,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
});
