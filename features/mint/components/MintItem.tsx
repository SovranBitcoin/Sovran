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
import { Spinner } from '@/shared/ui/primitives/Spinner';
import opacity from 'hex-color-opacity';
import { Checkbox } from '@/shared/ui/primitives/Checkbox';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { cashuLog, Log } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

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

  // Build inline stats: "<icon> value • <icon> value • ..."
  const statItems = useMemo(() => {
    const items: { icon: string; value: string; color: string }[] = [];
    if (displayScore !== undefined)
      items.push({ icon: 'ic:round-star', value: displayScore, color: warning });
    if (successRate !== undefined)
      items.push({
        icon: 'lucide:activity',
        value: `${successRate}%`,
        color: item.auditState === 'ERROR' ? '#EF4444' : success,
      });
    if ((item.contactReputation ?? 0) > 0)
      items.push({ icon: 'mdi:shield-check', value: `${item.contactReputation}`, color: '#3B82F6' });
    if ((item.contactFollowers ?? 0) > 0)
      items.push({ icon: 'mdi:account-group', value: item.contactFollowers!.toLocaleString(), color: '#3B82F6' });
    if (item.worksOffline === true)
      items.push({ icon: 'mdi:airplane', value: 'Offline', color: success });
    return items;
  }, [displayScore, successRate, item, warning, success]);

  return (
    <Log name="MintItem">
      <TouchableOpacity
        key={item.mintUrl}
        style={{ paddingHorizontal: 20, paddingVertical: 12, opacity: itemOpacity }}
        onPress={() => {
          cashuLog.debug('mint_item.press', {
            mintUrl: item.mintUrl,
            displayName: item.displayName,
            status: item.status,
          });
          onPress();
        }}
        disabled={isDisabled}>
        <HStack align="center" gap={12}>
          <Avatar
            key={item.mintUrl}
            picture={item.iconUrl}
            size={44}
            name={item.displayName}
            alt={`${item.displayName} mint`}
          />

          <VStack flex={1} style={{ gap: 2 }}>
            <Text className="text-foreground" size={16} bold>
              {item.displayName}
            </Text>

            <AmountFormatter
              amount={item.balance}
              unit={item.unit}
              size={14}
              weight="heavy"
              color={foreground}
            />

            {statItems.length > 0 && (
              <HStack align="center" style={{ gap: 4, marginTop: 2 }}>
                {statItems.map((stat, i) => (
                  <React.Fragment key={stat.icon}>
                    {i > 0 && (
                      <Text size={9} color={opacity(foreground, 0.15)}>
                        {'•'}
                      </Text>
                    )}
                    <HStack align="center" style={{ gap: 3 }}>
                      <Icon name={stat.icon} size={12} color={stat.color} />
                      <Text size={12} bold color={stat.color}>
                        {stat.value}
                      </Text>
                    </HStack>
                  </React.Fragment>
                ))}
              </HStack>
            )}

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
      </TouchableOpacity>
    </Log>
  );
};

export { MintItem };
