/**
 * @fileoverview MintItem — displays a single mint row in the mint selection list.
 *
 * Receives a pre-built MintListItem (no data fetching).
 * Audit and KYM scores are passed in directly from the item.
 */

import React, { memo, useMemo } from 'react';

import type { MintListItem } from 'coco-payment-ux';

import { Text } from '@/shared/ui/primitives/Text';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import Icon from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import opacity from 'hex-color-opacity';
import { Checkbox } from '@/shared/ui/primitives/Checkbox';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { cashuLog, Log } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

// ── Stat cell for the 2-column grid ─────────────────────────────────────────

interface StatCellProps {
  icon: string;
  value: string;
  color: string;
}

const StatCell = memo(function StatCell({ icon, value, color }: StatCellProps) {
  return (
    <HStack align="center" justify="center" gap={5} style={{ flex: 1, paddingVertical: 10 }}>
      <Icon name={icon} size={14} color={color} />
      <Text size={13} bold color={color}>{value}</Text>
    </HStack>
  );
});

const StatDividerV = memo(function StatDividerV({ color }: { color: string }) {
  return <View style={{ width: 1, backgroundColor: opacity(color, 0.08), marginVertical: 6 }} />;
});

const StatDividerH = memo(function StatDividerH({ color }: { color: string }) {
  return <View style={{ height: 1, backgroundColor: opacity(color, 0.08), marginHorizontal: 8 }} />;
});

interface MintItemProps {
  item: MintListItem;
  onPress: () => void;
  /** True when this specific mint's action is loading (e.g. spinner after selection). */
  isLoading?: boolean;
  /** True when any handler is executing — dims all rows. */
  globalLoading?: boolean;
  showDetailsButton?: boolean;
  onInspectPress?: () => void;
  showCheckbox?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  /** Human-readable explanation for why this mint is unavailable (pre-computed from item.reason). */
  disabledReason?: string | null;
}

const MintItem: React.FC<MintItemProps> = ({
  item,
  onPress,
  isLoading = false,
  globalLoading = false,
  showDetailsButton = false,
  onInspectPress,
  showCheckbox = false,
  selected = false,
  onToggle,
  disabledReason = null,
}) => {
  const [foreground, warning, success] = useThemeColor([
    'foreground',
    'yellow-300',
    'success',
  ] as const);

  const isAllowed = item.status === 'available';

  const itemOpacity = useMemo(() => {
    if (!isAllowed) return 0.5;
    if (globalLoading) return 0.5;
    return 1;
  }, [isAllowed, globalLoading]);

  const isDisabled = !isAllowed || globalLoading;

  const displayScore = useMemo(() => {
    if (typeof item.kymScore !== 'number') return undefined;
    return item.kymScore % 1 === 0 ? item.kymScore.toString() : item.kymScore.toFixed(1);
  }, [item.kymScore]);

  const successRate = useMemo(() => {
    if (item.auditScore === undefined) return undefined;
    return Math.round((item.auditScore / 5) * 100);
  }, [item.auditScore]);

  const activityBadgeVariant = item.auditState === 'ERROR' ? 'error' : 'success';

  const hasBadges =
    displayScore !== undefined || successRate !== undefined || item.worksOffline === true || (item.contactFollowers ?? 0) > 0 || (item.contactReputation ?? 0) > 0;

  return (
    <Log name="MintItem">
      <TouchableOpacity
        key={item.mintUrl}
        className="bg-surface mb-1 rounded-2xl p-4"
        style={{ opacity: itemOpacity }}
        onPress={() => {
          cashuLog.debug('mint_item.press', { mintUrl: item.mintUrl, displayName: item.displayName, status: item.status });
          onPress();
        }}
        disabled={isDisabled}>
        <VStack gap={0}>
        <HStack align="center" gap={12}>
          <View className="relative">
            <Avatar
              key={item.mintUrl}
              picture={item.iconUrl}
              size={42}
              name={item.displayName}
              alt={`${item.displayName} mint`}
            />
          </View>

          <VStack flex={1}>
            <Text className="text-foreground" size={16} bold>
              {item.displayName}
            </Text>

            <View className="self-start">
              <AmountFormatter
                amount={item.balance}
                unit={item.unit}
                size={14}
                weight="heavy"
                color={foreground}
                className="ml-[2px]"
              />
            </View>

            {disabledReason ? (
              <Text size={12} color={opacity(foreground, 0.6)}>
                {disabledReason}
              </Text>
            ) : null}
          </VStack>

          {isLoading ? (
            <View className="rounded-full bg-transparent p-2">
              <Spinner size={20} />
            </View>
          ) : showCheckbox ? (
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggle?.()}
              size={24}
              variant="success"
            />
          ) : (
            showDetailsButton && (
              <TouchableOpacity onPress={() => onInspectPress?.()}>
                <Icon className="bg-default rounded-full p-2" name="bx:dots-vertical-rounded" />
              </TouchableOpacity>
            )
          )}
        </HStack>

        {hasBadges && (
          <>
            <Spacer size={8} />
            <View
              className="bg-surface-secondary overflow-hidden"
              style={{ borderRadius: 16, borderCurve: 'continuous' }}>
              {/* Row 1 */}
              <HStack>
                {displayScore !== undefined ? (
                  <StatCell icon="ic:round-star" value={displayScore} color={warning} />
                ) : null}
                {displayScore !== undefined && successRate !== undefined ? (
                  <StatDividerV color={foreground} />
                ) : null}
                {successRate !== undefined ? (
                  <StatCell
                    icon="lucide:activity"
                    value={`${successRate}%`}
                    color={item.auditState === 'ERROR' ? '#EF4444' : success}
                  />
                ) : null}
              </HStack>

              {/* Row divider — only if there's a second row */}
              {((item.contactReputation ?? 0) > 0 || (item.contactFollowers ?? 0) > 0 || item.worksOffline) &&
               (displayScore !== undefined || successRate !== undefined) ? (
                <StatDividerH color={foreground} />
              ) : null}

              {/* Row 2 */}
              {((item.contactReputation ?? 0) > 0 || (item.contactFollowers ?? 0) > 0 || item.worksOffline) && (
                <HStack>
                  {(item.contactReputation ?? 0) > 0 ? (
                    <StatCell icon="mdi:shield-check" value={`${item.contactReputation} / 100`} color="#3B82F6" />
                  ) : null}
                  {(item.contactReputation ?? 0) > 0 && (item.contactFollowers ?? 0) > 0 ? (
                    <StatDividerV color={foreground} />
                  ) : null}
                  {(item.contactFollowers ?? 0) > 0 ? (
                    <StatCell icon="mdi:account-group" value={item.contactFollowers!.toLocaleString()} color="#3B82F6" />
                  ) : null}
                  {item.worksOffline === true && ((item.contactReputation ?? 0) > 0 || (item.contactFollowers ?? 0) > 0) ? (
                    <StatDividerV color={foreground} />
                  ) : null}
                  {item.worksOffline === true ? (
                    <StatCell icon="mdi:airplane" value="Offline" color={success} />
                  ) : null}
                </HStack>
              )}
            </View>
          </>
        )}
        </VStack>
      </TouchableOpacity>
    </Log>
  );
};

export { MintItem };
