import React from 'react';
import { HStack } from 'components/ui/View/HStack';
import { Text } from 'components/ui/Text';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNostrProfile } from './useNostrProfile';
import { getTimeAgo } from 'helper/time';

interface PostTopProps {
  post: any;
}

export function PostTop({ post }: PostTopProps) {
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
        <Skeleton className="mr-2 h-4 w-24 rounded-lg bg-primary-700" />
      ) : (
        <Text className="text-primary-0" size={14} bold overpass>
          {displayName}
        </Text>
      )}
      <Text className="text-primary-200" size={14}>
        {' '}
        • {timeAgo}
      </Text>
    </HStack>
  );
}
