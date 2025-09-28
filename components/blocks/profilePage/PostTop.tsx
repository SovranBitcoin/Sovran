import React from 'react';
import { HStack } from 'components/ui/View';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { Text } from 'components/ui/Text';
import { GradientSkeleton } from 'components/ui/GradientSkeleton';
import { useNostrProfile } from 'app/ProfilePage/helper';
import { getTimeAgo } from 'helper/time';
import { memoizedGetTheme } from 'helper/redux/settings';

interface PostTopProps {
  post: any;
}

export function PostTop({ post }: PostTopProps) {
  const theme = useSelector(memoizedGetTheme);
  const profile = useNostrProfile({ id: post?.pubkey });
  let timeAgo = getTimeAgo(post.created_at);

  const displayName =
    profile?.displayName ||
    profile?.profile?.displayName ||
    profile?.display_name ||
    profile?.profile?.display_name ||
    profile?.name ||
    profile?.profile?.name;

  return (
    <HStack
      style={
        {
          // alignSelf: "flex-start",
        }
      }
      align="center">
      {!displayName ? (
        <GradientSkeleton
          startColor={greys(theme)[700]}
          endColor={greys(theme)[600]}
          width={100}
          height={16}
          style={{
            borderRadius: 8,
            marginRight: 8,
          }}
        />
      ) : (
        <Text
          style={{
            fontFamily: 'OverpassBold',
            fontSize: 14,
            color: greys(theme)[0],
          }}>
          {displayName}
        </Text>
      )}
      <Text
        style={{
          fontFamily: 'OverpassRegular',
          fontSize: 14,
          color: greys(theme)[200],
        }}>
        {' '}
        • {timeAgo}
      </Text>
    </HStack>
  );
}
