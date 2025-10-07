import React from 'react';
import { View, VStack, HStack } from 'components/ui/View';
import { Avatar } from 'components/ui/Avatar';
import { PostTop } from './PostTop';
import { TextContent, extractUrls } from './TextContent';
import { ActionItems, usePostReactions } from './ActionItems';
import { RepostText } from './RepostText';
import { UrlProcessor } from './UrlProcessor';
import { useNostrProfile } from './useNostrProfile';
import { EventKind } from 'helper/constants';

interface PostProps {
  post: any;
}

export function Post({ post }: PostProps) {
  // Check if this is a repost
  const isRepost = post?.kind === EventKind.Repost;

  // For reposts, use the original post ID for reactions, otherwise use the post ID
  const postIdForReactions = isRepost
    ? post?.tags?.find((tag: any) => tag[0] === 'e')?.[1] || post?.id
    : post?.id;

  const { reactionCount, repostCount, zapCount } = usePostReactions({ id: postIdForReactions });

  // Debug logging for post IDs
  console.log('Post ID for reactions:', postIdForReactions);
  console.log('Is repost:', isRepost);

  // Get profiles for avatar display
  const originalAuthorProfile = useNostrProfile({
    id: post?.tags?.find((tag: any) => tag[0] === 'p')?.[1] || post?.pubkey,
  });
  const reposterProfile = useNostrProfile({ id: post?.pubkey });

  const avatarProfile = isRepost ? originalAuthorProfile : reposterProfile;
  const avatarPicture =
    (avatarProfile as any)?.picture ||
    (avatarProfile as any)?.profile?.picture ||
    (avatarProfile as any)?.image ||
    (avatarProfile as any)?.profile?.image;

  // For reposts, extract the original post from tags
  let originalPost = null;
  if (isRepost) {
    // Look for the 'e' tag which contains the event ID of the reposted post
    const eventTag = post?.tags?.find((tag: any) => tag[0] === 'e');
    // Look for the 'p' tag which contains the pubkey of the original post author
    const authorTag = post?.tags?.find((tag: any) => tag[0] === 'p');

    if (eventTag) {
      // Debug logging to see what the repost content looks like
      console.log('Repost content:', post?.content);
      console.log('Repost content type:', typeof post?.content);
      console.log('Original author pubkey:', authorTag?.[1]);

      // For reposts, the content might be JSON string that needs parsing
      let repostContent = post?.content || '';

      // Handle different content types
      if (typeof repostContent === 'string') {
        try {
          // Try to parse if it's a JSON string
          if (repostContent.startsWith('{') || repostContent.startsWith('[')) {
            const parsedContent = JSON.parse(repostContent);
            // Try different possible content fields
            repostContent =
              parsedContent.content ||
              parsedContent.text ||
              parsedContent.message ||
              parsedContent.body ||
              repostContent;
          }
        } catch (e) {
          // If parsing fails, use the original content
          console.log('Failed to parse repost content:', e);
        }
      } else if (typeof repostContent === 'object' && repostContent !== null) {
        // If it's already an object, extract the content field
        repostContent =
          repostContent.content ||
          repostContent.text ||
          repostContent.message ||
          repostContent.body ||
          JSON.stringify(repostContent);
      }

      originalPost = {
        content: repostContent,
        pubkey: authorTag?.[1] || post?.pubkey, // Use original author's pubkey
        created_at: post?.created_at,
        id: eventTag[1],
      };
    }
  }

  return (
    <View className="bg-primary-900 border-primary-800 mb-2 rounded-xl border p-4">
      <HStack align="flex-start" spacing={12}>
        {/* Avatar Column */}
        <VStack align="center" style={{ marginTop: 2 }}>
          <Avatar picture={avatarPicture} size={40} />
        </VStack>

        {/* Content Column */}
        <VStack flex={1} spacing={12}>
          {isRepost ? (
            <>
              <RepostText pubkey={post?.pubkey} repostCounter={1} />
              {originalPost && (
                <>
                  <PostTop post={originalPost} />
                  <TextContent content={originalPost?.content || ''} />
                  <UrlProcessor urls={extractUrls(originalPost?.content || '').urls || []} />
                </>
              )}
            </>
          ) : (
            <>
              <PostTop post={post} />
              <TextContent content={post?.content || ''} />
              <UrlProcessor urls={extractUrls(post?.content || '').urls || []} />
            </>
          )}
          <ActionItems
            reactionCount={reactionCount}
            repostCount={repostCount}
            zapCount={zapCount}
            size={16}
          />
        </VStack>
      </HStack>
    </View>
  );
}
