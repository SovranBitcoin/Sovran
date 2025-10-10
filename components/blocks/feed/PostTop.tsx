import React from 'react';
import { HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNostrProfile } from './useNostrProfile';
import { getTimeAgo } from 'helper/time';
import { useTheme } from 'providers/ThemeProvider';

interface PostTopProps {
  post: any;
}

export function PostTop({ post }: PostTopProps) {
  const { getPrimaryColor: _getPrimaryColor } = useTheme();
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
        <Skeleton className="bg-primary-700 mr-2 h-4 w-24 rounded-lg" />
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
