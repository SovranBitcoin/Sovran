/**
 * @fileoverview ListRoute - Mint selection with balances
 *
 * @module features/mint/components/MintItem
 *
 * @description
 * Displays owned mints with balances, currency filtering, and selection options.
 * Users can select mints for transactions, add new mints, or inspect details.
 *
 * **Navigation:**
 * - From: Initial route (sheet opens here)
 * - To: `router.navigate('add')` or `router.navigate('info', {mintUrl})`
 * - Close: `sheetRef.current?.hide({payload: selectedMint})`
 *
 * **Data:**
 * - Payload: `useSheetPayload('mint-balance')` - Configuration and callbacks
 * - Params: None (initial route)
 *
 * **Flow:** Load mints → display with balances → user selects → callback/navigate → close
 *
 * @see {@link ./add}
 * @see {@link ./info}
 */

import React, { useMemo } from 'react';
import { Text } from '@/shared/ui/primitives/Text';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import Icon from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Badge } from '@/shared/ui/primitives/Badge';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { getMintDisplayName, extractDomain } from '@/shared/lib/url';
import { Mint } from 'coco-cashu-core';
import { useAuditedMint } from '@/features/mint/hooks/useAuditedMint';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import opacity from 'hex-color-opacity';
import { Checkbox } from '@/shared/ui/primitives/Checkbox';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
interface MintItemProps {
  mint: Mint & { amount?: number; unit?: string };
  balance?: { amount: number; unit: string };
  mintUrl?: string;
  onPress: () => void;
  isLoading?: boolean;
  globalLoading?: boolean;
  requireBalance?: boolean;
  /** Minimum balance required - mints below this show at reduced opacity */
  minAmount?: number;
  selectedCurrency?: string;
  showDetailsButton?: boolean;
  onInspectPress?: () => void;
  kymScore?: number;
  kymLoading?: boolean;
  showCheckbox?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  /** Whether this mint is in the allowed list (for payment requests with specified mints) */
  isAllowed?: boolean;
}

const MintItem: React.FC<MintItemProps> = ({
  mint,
  balance,
  mintUrl: mintUrlProp,
  onPress,
  isLoading = false,
  globalLoading = false,
  requireBalance: _requireBalance = false,
  minAmount,
  showDetailsButton = false,
  onInspectPress,
  selectedCurrency: _selectedCurrency,
  kymScore,
  kymLoading = false,
  showCheckbox = false,
  selected = false,
  onToggle,
  isAllowed = true,
}) => {
  const [foreground, warning, success] = useThemeColor([
    'foreground',
    'yellow-300',
    'success',
  ] as const);
  const displayMintUrl = mintUrlProp || mint.mintUrl;
  const displayName = useMemo(
    () => getMintDisplayName(displayMintUrl, mint.mintInfo),
    [displayMintUrl, mint.mintInfo]
  );

  // Fetch audit data
  const { auditInfo, loading: auditLoading } = useAuditedMint(displayMintUrl);

  // Calculate success rate percentage
  const successRate = useMemo(() => {
    if (auditInfo?.score !== undefined) {
      // Use auditInfo.score (0-5 scale), normalize to 0-1 then convert to percentage
      return Math.round((auditInfo.score / 5) * 100);
    }
    if (auditInfo?.auditorData) {
      const { mints, melts, errors } = auditInfo.auditorData;
      const totalOps = (mints || 0) + (melts || 0);
      if (totalOps > 0) {
        return Math.round((1 - (errors || 0) / totalOps) * 100);
      }
    }
    return undefined;
  }, [auditInfo]);

  // Format score (round to 1 decimal or whole number)
  // Note: score of 0 is a valid value, so we check typeof === 'number' not just truthiness
  const displayScore = useMemo(() => {
    if (typeof kymScore !== 'number') return undefined;
    return kymScore % 1 === 0 ? kymScore.toString() : kymScore.toFixed(1);
  }, [kymScore]);

  // Determine badge variant based on audit state
  const activityBadgeVariant = useMemo(() => {
    const state = auditInfo?.auditorData?.state;
    if (state === 'ERROR') {
      return 'error';
    }
    // Default to success for OK state or when state is undefined/loading
    return 'success';
  }, [auditInfo?.auditorData?.state]);

  // Determine opacity based on balance and requirements
  const itemOpacity = useMemo(() => {
    // Not in allowed mints list
    if (!isAllowed) return 0.5;
    if (globalLoading) return 0.5;
    if (balance && balance.amount === 0 && _requireBalance) return 0.5;
    // Show at reduced opacity if balance is below minimum required amount
    if (minAmount !== undefined && minAmount > 0 && balance && balance.amount < minAmount)
      return 0.5;
    return 1;
  }, [isAllowed, globalLoading, balance, _requireBalance, minAmount]);

  // Check if this mint has insufficient balance for selection
  const hasInsufficientBalance = useMemo(() => {
    if (minAmount !== undefined && minAmount > 0 && balance) {
      return balance.amount < minAmount;
    }
    return false;
  }, [minAmount, balance]);

  // Check if this mint is disabled (not allowed or insufficient balance)
  const isDisabled = !isAllowed || globalLoading || hasInsufficientBalance;

  return (
    <TouchableOpacity
      key={mint.mintUrl}
      className="bg-surface mb-1 rounded-2xl p-4"
      style={{ opacity: itemOpacity }}
      onPress={onPress}
      disabled={isDisabled}>
      <VStack gap={0}>
        {/* Top section: Logo, name, balance/URL, checkbox/dots */}
        <HStack align="center" gap={12}>
          <View className="relative">
            <Avatar
              key={mint.mintUrl}
              picture={mint.mintInfo?.icon_url || undefined}
              size={42}
              variant="mint"
              name={displayName}
              alt={`${displayName} mint`}
            />
          </View>

          <VStack flex={1}>
            <Text className="text-foreground" size={16} bold>
              {displayName}
            </Text>

            <View className="self-start">
              {balance ? (
                <AmountFormatter
                  amount={balance.amount}
                  unit={'sat'}
                  size={14}
                  weight="heavy"
                  color={foreground}
                  className="ml-[2px]"
                />
              ) : displayMintUrl ? (
                <Text heavy size={14} color={opacity(foreground, 0.5)}>
                  {extractDomain(displayMintUrl)}
                </Text>
              ) : null}
            </View>
          </VStack>

          {isLoading ? (
            <View className="rounded-full bg-transparent p-2">
              <Spinner size={20} />
            </View>
          ) : showCheckbox ? (
            <Checkbox
              checked={selected}
              onCheckedChange={() => {
                if (onToggle) {
                  onToggle();
                }
              }}
              size={24}
              variant="success"
            />
          ) : (
            showDetailsButton && (
              <TouchableOpacity
                onPress={() => {
                  if (onInspectPress) {
                    onInspectPress();
                  }
                }}>
                <Icon className="bg-default rounded-full p-2" name="bx:dots-vertical-rounded" />
              </TouchableOpacity>
            )
          )}
        </HStack>

        {(displayScore || kymLoading || successRate !== undefined || auditLoading) && (
          <>
            <Spacer size={12} />
            <HStack gap={8}>
              {/* Score badge (left) - show badge when score available, skeleton when loading without score */}
              {displayScore ? (
                <Badge className="h-[24px] w-[56px]" variant="star" icon="ic:round-star" size={14}>
                  {displayScore}
                </Badge>
              ) : kymLoading ? (
                <Skeleton
                  className="h-[24px] w-[56px] rounded-full"
                  style={{
                    backgroundColor: opacity(warning, 0.2),
                  }}
                />
              ) : null}

              {/* Success rate badge (right) - show badge when available, skeleton only when loading */}
              {successRate !== undefined ? (
                <Badge
                  className="h-[24px] w-[60px]"
                  variant={activityBadgeVariant}
                  icon="lucide:activity"
                  size={14}>
                  {`${successRate}%`}
                </Badge>
              ) : auditLoading ? (
                <Skeleton
                  className="h-[24px] w-[60px] rounded-full"
                  style={{
                    backgroundColor: opacity(success, 0.2),
                  }}
                />
              ) : null}
            </HStack>
          </>
        )}
      </VStack>
    </TouchableOpacity>
  );
};

export { MintItem };
