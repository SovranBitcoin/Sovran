/**
 * Polished follow-relationship pill for people rows (search results, profile
 * headers). Shows "Following" / "Follows you" / "Mutual".
 *
 * "Following" (viewer→them) is known locally and instant. "Follows you" and
 * "Mutual" require the server (nagg `followStatus`) — pass `relationship` when
 * available; otherwise the badge falls back to local following knowledge.
 */
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { alpha, radius, spacing } from '@/shared/styles/tokens';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import {
  selectIsFollowingPubkey,
  useNostrSocialStore,
} from '@/shared/stores/profile/nostrSocialStore';

type FollowRelationship = 'following' | 'follows_you' | 'mutual' | 'none';

interface FollowBadgeProps {
  pubkey: string;
}

export function FollowBadge({ pubkey }: FollowBadgeProps) {
  const isFollowingLocal = useNostrSocialStore(selectIsFollowingPubkey(pubkey));
  const [success, accent] = useThemeColor(['success', 'accent'] as const);

  const resolved: FollowRelationship = isFollowingLocal ? 'following' : 'none';

  if (resolved === 'none') return null;

  const config: Record<
    Exclude<FollowRelationship, 'none'>,
    { label: string; color: string; icon: string | null }
  > = {
    mutual: { label: 'Mutual', color: success, icon: 'fluent:checkmark-16-filled' },
    following: { label: 'Following', color: success, icon: 'fluent:checkmark-16-filled' },
    follows_you: { label: 'Follows you', color: accent, icon: null },
  };
  const { label, color, icon } = config[resolved];

  return (
    <HStack
      align="center"
      gap={spacing.xs}
      style={[styles.pill, { backgroundColor: opacity(color, alpha.faint) }]}>
      {icon ? <Icon name={icon} size={12} color={color} /> : null}
      <Text size={11} bold style={{ color }}>
        {label}
      </Text>
    </HStack>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
});
