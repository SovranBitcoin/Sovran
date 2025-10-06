import React from 'react';
import { HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { GradientSkeleton } from 'components/ui/GradientSkeleton';
import { useNostrProfile } from './useNostrProfile';
import { getTimeAgo } from 'helper/time';
import { useTheme } from 'providers/ThemeProvider';

interface PostTopProps {
  post: any;
}

export function PostTop({ post }: PostTopProps) {
  const { getPrimaryColor } = useTheme();
  const profile = useNostrProfile({ id: post?.pubkey });
  let timeAgo = getTimeAgo(post.created_at);

  const displayName =
    (profile as any)?.displayName ||
    (profile as any)?.profile?.displayName ||
    (profile as any)?.display_name ||
    (profile as any)?.profile?.display_name ||
    (profile as any)?.name ||
    (profile as any)?.profile?.name;

  return (
    <HStack align="center">
      {!displayName ? (
        <GradientSkeleton
          startColor={getPrimaryColor('700')}
          endColor={getPrimaryColor('600')}
          width={100}
          height={16}
          style={{
            borderRadius: 8,
            marginRight: 8,
          }}
        />
      ) : (
        <Text
          className="text-primary-0"
          style={{
            fontFamily: 'OverpassBold',
            fontSize: 14,
          }}>
          {displayName}
        </Text>
      )}
      <Text
        className="text-primary-200"
        style={{
          fontFamily: 'OverpassRegular',
          fontSize: 14,
        }}>
        {' '}
        • {timeAgo}
      </Text>
    </HStack>
  );
}
