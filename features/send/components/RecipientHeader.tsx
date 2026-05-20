/**
 * Stack.Screen `headerTitle` content used by AmountFlowScreen when the
 * melt target resolves to a known Nostr identity. Avatar on top, "Pay
 * <name>" centered below — the alternative to the MintSelector pill that
 * the screen renders by default.
 */
import React from 'react';

import { HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';

interface RecipientHeaderProps {
  pubkey: string;
  displayName: string;
  avatarUrl?: string | null;
}

export function RecipientHeader({ pubkey, displayName, avatarUrl }: RecipientHeaderProps) {
  const foreground = useThemeColor('foreground');
  return (
    <VStack align="center" gap={4} style={{ paddingTop: 20 }}>
      <Avatar
        state={avatarUrl ? 'image' : 'fallback'}
        picture={avatarUrl ?? undefined}
        size={HEADER_LAYOUT.TOOLBAR_BUTTON_WIDTH}
        name={displayName}
        seed={pubkey}
        alt={`${displayName} avatar`}
      />
      <Text size={14} weight="bold" style={{ color: foreground }}>
        Pay {displayName}
      </Text>
    </VStack>
  );
}
