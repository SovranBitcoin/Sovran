import React from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { withAlpha } from '@/shared/lib/color';
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
import { log, mintUrlLogFields } from '@/shared/lib/logger';
import { alpha, radius, spacing } from '@/shared/styles/tokens';

interface CashuTokenBubbleProps {
  token: string;
  isOwn: boolean;
  hasText?: boolean;
  cornerRadii?: Pick<
    ViewStyle,
    | 'borderTopLeftRadius'
    | 'borderBottomLeftRadius'
    | 'borderTopRightRadius'
    | 'borderBottomRightRadius'
  >;
}

interface DecodedCashuTokenBubble {
  amount: number;
  unit: string;
  mintUrl: string;
  proofCount: number;
  hasP2PKProofs: boolean;
}

function tokenLogFields(token: string): Record<string, unknown> {
  return {
    tokenLength: token.length,
  };
}

function hasP2PKProofs(proofs: readonly { secret: string }[]): boolean {
  return proofs.some((proof) => {
    try {
      const parsed = JSON.parse(proof.secret);
      return Array.isArray(parsed) && parsed[0] === 'P2PK';
    } catch {
      return false;
    }
  });
}

/** Decode + log a chat ecash token, verbatim from the render memo; null when invalid. */
function decodeCashuTokenBubble(token: string, isOwn: boolean): DecodedCashuTokenBubble | null {
  try {
    const decoded = getTokenMetadata(token);
    const next = {
      amount: amountToNumber(decoded.amount),
      unit: decoded.unit || 'sats',
      mintUrl: decoded.mint || '',
      proofCount: decoded.incompleteProofs.length,
      hasP2PKProofs: hasP2PKProofs(decoded.incompleteProofs),
    };
    log.info('chat.cashu_token.detected', {
      ...tokenLogFields(token),
      ...mintUrlLogFields(next.mintUrl),
      isOwn,
      amount: next.amount,
      unit: next.unit,
      proofCount: next.proofCount,
      hasP2PKProofs: next.hasP2PKProofs,
      expectedNext: isOwn ? 'cancel_or_ignore' : 'redeem_affordance',
    });
    return next;
  } catch (error) {
    log.warn('chat.cashu_token.decode_failed', {
      ...tokenLogFields(token),
      isOwn,
      error,
    });
    return null;
  }
}

/**
 * Build the receive history entry for the tap-to-redeem navigation, verbatim
 * from the press handler; surfaces the invalid-token popup and returns null
 * when the token can't build one.
 */
function buildReceiveEntrySafe(
  token: string,
  decodedToken: DecodedCashuTokenBubble,
  isOwn: boolean
): ReturnType<typeof buildReceiveHistoryEntry> | null {
  try {
    return buildReceiveHistoryEntry(token, decodedToken.unit);
  } catch (error) {
    log.error('chat.cashu_token.build_receive_history_failed', {
      ...tokenLogFields(token),
      ...mintUrlLogFields(decodedToken.mintUrl),
      isOwn,
      error,
    });
    staticPopup('invalid-token');
    return null;
  }
}

/**
 * Inline ecash redeem affordance rendered alongside a chat-message bubble.
 * Lifted from `features/user/screens/UserMessagesScreen.tsx` so every DM
 * surface (NIP-04, NIP-17, MLS, BitChat nostr-dm/ble-dm) can present the
 * same Redeem/Cancel card.
 */
export function CashuTokenBubble({
  token,
  isOwn,
  hasText = false,
  cornerRadii,
}: CashuTokenBubbleProps) {
  const [foreground, defaultColor, surfaceTertiary, success] = useThemeColor([
    'foreground',
    'default',
    'surface-tertiary',
    'success',
  ] as const);

  const decodedToken = React.useMemo<DecodedCashuTokenBubble | null>(
    () => decodeCashuTokenBubble(token, isOwn),
    [isOwn, token]
  );

  const usdAmount = decodedToken
    ? formatAmount(
        { amount: decodedToken.amount, unit: decodedToken.unit },
        { displayAs: 'usd', currencyDisplay: 'symbol' }
      )
    : '';

  const handlePress = () => {
    if (!decodedToken) {
      log.warn('chat.cashu_token.press_invalid', {
        ...tokenLogFields(token),
        isOwn,
      });
      staticPopup('invalid-token');
      return;
    }

    const receiveHistoryEntry = buildReceiveEntrySafe(token, decodedToken, isOwn);
    if (!receiveHistoryEntry) return;

    log.info('chat.cashu_token.navigate_receive_token', {
      ...tokenLogFields(token),
      ...mintUrlLogFields(decodedToken.mintUrl),
      isOwn,
      historyEntryId: receiveHistoryEntry.id,
      historyState: receiveHistoryEntry.state,
      amount: decodedToken.amount,
      unit: decodedToken.unit,
      proofCount: decodedToken.proofCount,
      hasP2PKProofs: decodedToken.hasP2PKProofs,
      expectedNext: 'receive_token_screen_redeem',
    });

    router.navigate({
      pathname: '/receiveToken',
      params: {
        receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
      },
    });
  };

  if (!decodedToken) {
    return null;
  }

  // Share the message bubble's fill and grouping, with one subtle action pill.
  const actionColor = isOwn ? withAlpha(foreground, alpha.strong) : success;
  const { amount, unit, mintUrl } = decodedToken;

  return (
    <View
      className="mb-0 min-w-0 self-stretch"
      style={{
        marginTop: hasText ? spacing.sm : 0,
      }}>
      <Pressable
        onPress={handlePress}
        testID={isOwn ? 'cashu-bubble-own' : 'cashu-bubble-incoming'}
        accessibilityRole="button"
        accessibilityLabel={isOwn ? 'Sent ecash token' : 'Received ecash token'}
        accessibilityHint={isOwn ? 'Opens the token to cancel it' : 'Opens the token to redeem it'}>
        <VStack
          gap={spacing.sm}
          className="min-w-0 self-stretch p-3"
          style={{
            backgroundColor: isOwn ? defaultColor : surfaceTertiary,
            borderRadius: radius.lg,
            ...cornerRadii,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: withAlpha(foreground, alpha.subtle),
          }}>
          {mintUrl ? (
            <HStack align="center" gap={spacing.xs} className="min-w-0 shrink">
              <Icon
                name="mingcute:bank-fill"
                size={13}
                color={withAlpha(foreground, alpha.muted)}
              />
              <Text
                size={12}
                numberOfLines={1}
                style={{ color: withAlpha(foreground, alpha.muted), flexShrink: 1 }}>
                {mintUrl}
              </Text>
            </HStack>
          ) : null}

          <VStack gap={2} className="min-w-0 shrink">
            <AmountFormatter
              className="min-w-0 shrink flex-wrap"
              amount={amount}
              unit={unit}
              size={24}
              weight="medium"
              color={foreground}
            />
            {usdAmount ? (
              <Text size={13} style={{ color: withAlpha(foreground, alpha.muted) }}>
                {usdAmount}
              </Text>
            ) : null}
          </VStack>

          {/* The whole bubble is the one control; this pill only shows what a
              tap does. A second pressable here would be unreachable inside the
              bubble for VoiceOver and the harness. */}
          <View
            testID={isOwn ? 'cashu-bubble-cancel' : 'cashu-bubble-redeem'}
            style={{
              marginTop: spacing.xs,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              backgroundColor: withAlpha(actionColor, alpha.subtle),
              borderRadius: radius.md,
              alignItems: 'center',
            }}>
            <HStack align="center" gap={6}>
              {!isOwn ? (
                <Icon name="material-symbols:arrow-downward" size={16} color={actionColor} />
              ) : null}
              <Text size={14} bold style={{ color: actionColor }}>
                {isOwn ? 'Cancel' : 'Redeem'}
              </Text>
            </HStack>
          </View>
        </VStack>
      </Pressable>
    </View>
  );
}
