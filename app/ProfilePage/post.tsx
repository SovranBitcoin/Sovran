import React from 'react';
import { View } from 'react-native';
import { HStack } from 'components/ui/View';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { Text } from 'components/ui/Text';
import 'react-native-gesture-handler';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import { GradientSkeleton } from 'components/ui/GradientSkeleton';
import { useNostrEvents } from 'nostr-react';
import { useNostrProfile } from './helper';
import { nip19 } from 'nostr-tools';

import { ActionItems, usePostReactions } from 'components/blocks/profilePage';
import { ExternalLink } from 'components/blocks/profilePage';
import { VideoScreen } from 'components/blocks/profilePage';
import { ImageContainer } from 'components/blocks/profilePage';
import { extractUrls, TextContent } from 'components/blocks/profilePage';
import CachedImage from 'components/ui/Image';
import { memoizedGetTheme } from 'helper/redux/settings';
import { UserNameProfiles } from 'components/ui/UserNameProfiles';
import { getTimeAgo } from 'helper/time';
dayjs.extend(relativeTime);

export const PostQuote = React.memo(({ id }: { id: string }) => {
  const theme = useSelector(memoizedGetTheme);

  const { events } = useNostrEvents({ filter: { ids: [id] } });
  const authorPubKey = events?.[0]?.pubkey;

  const profile = useNostrProfile({ id: authorPubKey });

  let timeAgo = getTimeAgo(events?.[0]?.created_at);

  return (
    <View
      style={{
        backgroundColor: greys(theme)[800],
        borderRadius: 8,
        padding: 8,
        marginBottom: 8,
        marginLeft: 56,
      }}>
      <HStack align="center">
        <CachedImage
          style={{ width: 32, height: 32, borderRadius: 100000 }}
          source={{ uri: profile?.picture }}
        />
        <HStack
          style={{
            marginLeft: 4,
            marginBottom: 4,
          }}
          align="center">
          <Text>{profile?.displayName}</Text>
          <Text
            style={{
              color: greys(theme)[100],
            }}>
            {'  '}•{'  '}
            {timeAgo}
          </Text>
        </HStack>
      </HStack>
      <Text>{events?.[0]?.content}</Text>
    </View>
  );
});

PostQuote.displayName = 'PostQuote';

export function getPost(post) {
  if (typeof post?.content === 'string') {
    try {
      post = JSON.parse(post?.content);
    } catch {
      //
    }
  }
  return post;
}

function UrlProcessor({ urls }: { urls: string[] }) {
  const isImageUrl = (url: string) => {
    return /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(url);
  };

  const isVideoUrl = (url: string) => {
    return /\.(mp4|webm|ogg|mov|bin)$/i.test(url);
  };

  return (
    <View>
      {urls?.map((url) =>
        isImageUrl(url) ? (
          <ImageContainer key={url} url={url} />
        ) : isVideoUrl(url) ? (
          <VideoScreen key={url} videoSource={url} />
        ) : !isVideoUrl(url) && !isImageUrl(url) ? (
          <ExternalLink key={url} url={url} />
        ) : null
      )}
    </View>
  );
}

function RepostText({ pubkey, repostCounter }) {
  const theme = useSelector(memoizedGetTheme);

  return (
    <HStack
      style={{
        marginBottom: 12,
      }}
      align="center">
      <Icon name="garden:arrow-retweet-fill-16" size={16} color={greys(theme)[400]} />

      <UserNameProfiles
        pubkey={pubkey}
        style={{
          fontFamily: 'OverpassBold',
          fontSize: 14,
          color: greys(theme)[400],
        }}
      />
      {repostCounter > 1 ? (
        <Text
          style={{
            fontFamily: 'OverpassBold',
            fontSize: 14,
            color: greys(theme)[400],
          }}>
          {` and ${repostCounter - 1} other ${
            repostCounter - 1 > 1 ? 'people' : 'person'
          } reposted`}
        </Text>
      ) : (
        <Text
          style={{
            fontFamily: 'OverpassBold',
            fontSize: 14,
            color: greys(theme)[400],
          }}>
          {' reposted'}
        </Text>
      )}
    </HStack>
  );
}

export function ProfileIcon({ pubkey }) {
  const theme = useSelector(memoizedGetTheme);
  const profile = useNostrProfile({ id: pubkey });
  const [imageLoading, setImageLoading] = React.useState(true);

  return (
    <View
      style={{
        width: 48,
        height: 48,
        backgroundColor: greys(theme)[700],
        borderRadius: 16111,
        marginRight: 8,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
      }}>
      {profile?.picture ? (
        <>
          {imageLoading && (
            <GradientSkeleton
              startColor={greys(theme)[700]}
              endColor={greys(theme)[600]}
              width={48}
              height={48}
              style={{
                position: 'absolute',
                borderRadius: 16111,
              }}
            />
          )}
          <CachedImage
            style={{
              width: 48,
              height: 48,
            }}
            source={{ uri: profile?.picture }}
            onLoadStart={() => setImageLoading(true)}
            onLoadEnd={() => setImageLoading(false)}
          />
        </>
      ) : (
        // Show first letter of username if no picture
        <Text
          style={{
            fontSize: 20,
            color: greys(theme)[100],
            fontFamily: 'OverpassBold',
          }}>
          {(profile?.displayName || profile?.name || 'A')?.[0]?.toUpperCase()}
        </Text>
      )}
    </View>
  );
}

function PostTop({ post }) {
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

export const Post = React.memo(({ active = false, showNested = false, post, index }) => {
  let post_ = getPost(post);
  const theme = useSelector(memoizedGetTheme);
  const { reactionCount, repostCount, zapCount } = usePostReactions({
    id: post_.id,
  });

  try {
    const { nostrEvents } = extractUrls(post_?.content);
    const quote =
      post_?.tags?.find((t) => t?.[0] === 'alt')?.[1] === 'Repost event' ||
      post_?.tags?.find((t) => t?.[0] === 'q')?.[1] ||
      (nostrEvents?.[0]?.replace('nostr:', '')
        ? nip19.decode(nostrEvents?.[0]?.replace('nostr:', ''))?.data
        : null);

    return (
      <TouchableOpacity
        onPress={() => {
          // navigation.navigate("post", {
          //   event: post_,
          //   parentPosts: isResponse ? [...parentPosts] : parentPosts,
          // });
        }}
        key={index}
        style={{
          backgroundColor: greys(theme)[950],
          padding: 12,
          borderBottomWidth: 1,
          borderColor: greys(theme)[600],
        }}>
        {post.kind === 6 && <RepostText pubkey={post.pubkey} repostCounter={repostCount} />}
        <HStack>
          {!active && <ProfileIcon pubkey={post_?.pubkey} />}
          <View style={{ flex: 1 }}>
            <HStack
              style={{
                alignSelf: 'flex-start',
                marginBottom: active ? 16 : 0,
              }}
              align="center">
              {active && <ProfileIcon pubkey={post_?.pubkey} />}
              <PostTop post={post_} />
            </HStack>
            <TextContent content={post_.content} fontSize={active ? 18 : 14} />
            <UrlProcessor urls={extractUrls(post_?.content)?.urls} />
          </View>
        </HStack>
        {showNested && quote && <PostQuote id={quote} />}
        <ActionItems
          id={post_.id}
          reactionCount={reactionCount}
          repostCount={repostCount}
          zapCount={zapCount}
          size={!active ? 16 : 24}
        />
      </TouchableOpacity>
    );
  } catch (err) {
    return (
      <View>
        <Text>{JSON.stringify(err)}</Text>
      </View>
    );
  }
});

Post.displayName = 'Post';
