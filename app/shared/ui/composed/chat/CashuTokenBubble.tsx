import React from 'react';
import { StyleSheet } from 'react-native';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
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

interface DecodedCashuTokenBubble {
  amount: number;
  unit: string;
  mintUrl: string;
  proofCount: number;
  hasP2PKProofs: boolean;
}

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
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

  const decodedToken = React.useMemo<DecodedCashuTokenBubble | null>(() => {
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
  }, [isOwn, token]);

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

    let receiveHistoryEntry: ReturnType<typeof buildReceiveHistoryEntry>;
    try {
      receiveHistoryEntry = buildReceiveHistoryEntry(token, decodedToken.unit);
    } catch (error) {
      log.error('chat.cashu_token.build_receive_history_failed', {
        ...tokenLogFields(token),
        ...mintUrlLogFields(decodedToken.mintUrl),
        isOwn,
        error,
      });
      staticPopup('invalid-token');
      return;
    }

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

  // Quiet flat card: a single `surface-secondary` fill with a hairline border —
  // no nested gradients, modest type — so an ecash drop reads as a calm
  // affordance in the message stream rather than a loud hero banner. The action
  // is a subtle tinted pill (success for Redeem, muted for Cancel).
  const actionColor = isOwn ? opacity(foreground, alpha.strong) : success;
  const { amount, unit, mintUrl } = decodedToken;

  return (
    <View
      style={{
        marginTop: spacing.sm,
        marginBottom: spacing.sm,
        alignSelf: isOwn ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
      }}>
      <Pressable
        onPress={handlePress}
        testID={isOwn ? 'cashu-bubble-own' : 'cashu-bubble-incoming'}
        accessibilityRole="button"
        accessibilityLabel={isOwn ? 'Sent ecash token' : 'Received ecash token'}>
        <VStack
          gap={spacing.sm}
          style={{
            backgroundColor: surfaceSecondary,
            borderRadius: radius.lg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: surfaceTertiary,
            padding: spacing.md,
            minWidth: 200,
          }}>
          {mintUrl ? (
            <HStack align="center" gap={spacing.xs}>
              <Icon name="mingcute:bank-fill" size={13} color={opacity(foreground, alpha.muted)} />
              <Text
                size={12}
                numberOfLines={1}
                style={{ color: opacity(foreground, alpha.muted), flexShrink: 1 }}>
                {mintUrl}
              </Text>
            </HStack>
          ) : null}

          <VStack gap={2}>
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
            <HStack align="center" gap={6}>
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
