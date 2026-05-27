import React from 'react';
import { ColorValue } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
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
  const [foreground, defaultColor, surfaceTertiary, surfaceSecondary, surface, shade200, shade300] =
    useThemeColor([
      'foreground',
      'default',
      'surface-tertiary',
      'surface-secondary',
      'surface',
      'shade-200',
      'shade-300',
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

  const gradientColors: readonly [ColorValue, ColorValue, ...ColorValue[]] = isOwn
    ? [shade200, shade300]
    : [defaultColor, surfaceTertiary];

  const innerGradientColors: readonly [ColorValue, ColorValue, ...ColorValue[]] = isOwn
    ? [opacity(foreground, 0.2), opacity(foreground, 0.175)]
    : [surfaceSecondary, surface];

  return (
    <View
      style={{
        marginTop: 8,
        marginBottom: 8,
        alignSelf: isOwn ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
      }}>
      <Pressable onPress={handlePress}>
        <LinearGradient
          colors={gradientColors}
          style={{
            borderRadius: 18,
            padding: 12,
            minWidth: 200,
          }}>
          <VStack spacing={8}>
            {mintUrl && (
              <Text
                size={12}
                style={{
                  color: foreground,
                  opacity: 0.75,
                }}>
                {mintUrl}
              </Text>
            )}

            <LinearGradient
              colors={innerGradientColors}
              style={{
                borderRadius: 18,
                margin: 0,
              }}>
              <VStack spacing={4} justify="center" align="center" className="p-5">
                <AmountFormatter
                  amount={amount}
                  unit={unit}
                  size={32}
                  weight="heavy"
                  color={foreground}
                />
                {usdAmount && (
                  <Text
                    size={14}
                    style={{
                      color: foreground,
                      opacity: 0.9,
                    }}>
                    {usdAmount}
                  </Text>
                )}
              </VStack>
            </LinearGradient>

            <Pressable
              onPress={handlePress}
              style={{
                marginTop: 8,
                paddingVertical: 10,
                paddingHorizontal: 16,
                backgroundColor: foreground,
                borderRadius: 8,
                alignItems: 'center',
              }}>
              <HStack align="center" spacing={6}>
                {!isOwn && (
                  <Icon name="material-symbols:arrow-downward" size={16} color={defaultColor} />
                )}
                <Text
                  size={14}
                  bold
                  style={{
                    color: defaultColor,
                  }}>
                  {isOwn ? 'Cancel' : 'Redeem'}
                </Text>
              </HStack>
            </Pressable>
          </VStack>
        </LinearGradient>
      </Pressable>
    </View>
  );
}
