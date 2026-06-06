import React from 'react';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import opacity from 'hex-color-opacity';
import { getTokenMetadata } from '@cashu/cashu-ts';

import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import Icon from 'assets/icons';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatAmount } from '@/shared/lib/currency';
import { buildReceiveHistoryEntry } from '@/shared/lib/cashu/utils';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { staticPopup } from '@/shared/lib/popup';
import { log } from '@/shared/lib/logger';
import { alpha, radius, spacing } from '@/shared/styles/tokens';

interface CashuTokenBubbleProps {
  token: string;
  isOwn: boolean;
}

/**
 * Inline ecash redeem affordance rendered alongside a chat-message bubble.
 * Lifted from `features/user/screens/UserMessagesScreen.tsx` so every DM
 * surface (NIP-04, NIP-17, MLS, BitChat nostr-dm/ble-dm) can present the
 * same Redeem/Cancel card.
 */
export function CashuTokenBubble({ token, isOwn }: CashuTokenBubbleProps) {
  const [foreground, surfaceSecondary, surfaceTertiary, success] = useThemeColor([
    'foreground',
    'surface-secondary',
    'surface-tertiary',
    'success',
  ] as const);

  let amount = 0;
  let unit = '';
  let mintUrl = '';
  let isValid = false;

  try {
    const decoded = getTokenMetadata(token);
    amount = amountToNumber(decoded.amount);
    unit = decoded.unit || 'sats';
    mintUrl = decoded.mint || '';
    isValid = true;
  } catch (error) {
    log.error('chat.cashu_decode_failed', { error });
    isValid = false;
  }

  const usdAmount = isValid
    ? formatAmount({ amount, unit }, { displayAs: 'usd', currencyDisplay: 'symbol' })
    : '';

  const handlePress = () => {
    if (!isValid) {
      staticPopup('invalid-token');
      return;
    }

    const receiveHistoryEntry = buildReceiveHistoryEntry(token, unit);

    router.navigate({
      pathname: '/receiveToken',
      params: {
        receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
      },
    });
  };

  if (!isValid) {
    return null;
  }

  // Quiet flat card: a single `surface-secondary` fill with a hairline border —
  // no nested gradients, modest type — so an ecash drop reads as a calm
  // affordance in the message stream rather than a loud hero banner. The action
  // is a subtle tinted pill (success for Redeem, muted for Cancel).
  const actionColor = isOwn ? opacity(foreground, alpha.strong) : success;

  return (
    <View
      style={{
        marginTop: spacing.sm,
        marginBottom: spacing.sm,
        alignSelf: isOwn ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
      }}>
      <Pressable onPress={handlePress}>
        <VStack
          spacing={spacing.sm}
          style={{
            backgroundColor: surfaceSecondary,
            borderRadius: radius.lg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: surfaceTertiary,
            padding: spacing.md,
            minWidth: 200,
          }}>
          {mintUrl ? (
            <HStack align="center" spacing={spacing.xs}>
              <Icon name="mingcute:bank-fill" size={13} color={opacity(foreground, alpha.muted)} />
              <Text
                size={12}
                numberOfLines={1}
                style={{ color: opacity(foreground, alpha.muted), flexShrink: 1 }}>
                {mintUrl}
              </Text>
            </HStack>
          ) : null}

          <VStack spacing={2}>
            <AmountFormatter
              amount={amount}
              unit={unit}
              size={24}
              weight="medium"
              color={foreground}
            />
            {usdAmount ? (
              <Text size={13} style={{ color: opacity(foreground, alpha.muted) }}>
                {usdAmount}
              </Text>
            ) : null}
          </VStack>

          <Pressable
            onPress={handlePress}
            style={{
              marginTop: spacing.xs,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              backgroundColor: opacity(actionColor, alpha.subtle),
              borderRadius: radius.md,
              alignItems: 'center',
            }}>
            <HStack align="center" spacing={6}>
              {!isOwn ? (
                <Icon name="material-symbols:arrow-downward" size={16} color={actionColor} />
              ) : null}
              <Text size={14} bold style={{ color: actionColor }}>
                {isOwn ? 'Cancel' : 'Redeem'}
              </Text>
            </HStack>
          </Pressable>
        </VStack>
      </Pressable>
    </View>
  );
}
