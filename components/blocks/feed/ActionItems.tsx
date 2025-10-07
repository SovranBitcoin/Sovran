import React, { useEffect, useMemo, useState } from 'react';
import { HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import AsyncStorage from '@react-native-async-storage/async-storage'; // Assuming you're using AsyncStorage as backend for cache
import { Cache } from 'react-native-cache';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { EventKind } from 'helper/constants';
import { formatNumber } from 'helper/utils';
import { getLightningAmount } from '@/helper/coco/utils';

const reactionCache = new Cache({
  namespace: 'reactions',
  policy: {
    maxEntries: 100,
    stdTTL: 60 * 5, // 24 hours TTL in seconds
  },
  backend: AsyncStorage,
});

export const usePostReactions = ({ id }: { id: string }) => {
  const [reactionCount, setReactionCount] = useState(0);
  const [repostCount, setRepostCount] = useState(0); // New state for reposts
  const [zapCount, setZapCount] = useState(0); // New state for zaps
  const [toggle, setToggle] = useState(true); // For controlling fetching logic

  // Check the cache for existing reaction, repost, and zap counts
  useEffect(() => {
    async function checkCache() {
      if (!id) return;

      const cachedReactionCount = Number(await reactionCache.get(`${id}.reactions`));
      const cachedRepostCount = Number(await reactionCache.get(`${id}.reposts`)); // Check for cached reposts
      const cachedZapCount = Number(await reactionCache.get(`${id}.zaps`)); // Check for cached zaps

      if (cachedReactionCount !== undefined) {
        setReactionCount(cachedReactionCount);
      } else {
        setToggle(true); // Enable fetching if the reaction cache is empty
      }

      if (cachedRepostCount !== undefined) {
        setRepostCount(cachedRepostCount);
      } else {
        setToggle(true); // Enable fetching if the repost cache is empty
      }

      if (cachedZapCount !== undefined) {
        setZapCount(cachedZapCount);
      } else {
        setToggle(true); // Enable fetching if the zap cache is empty
      }
    }
    checkCache();
  }, [id]); // Run only when postId changes

  const filters = useMemo(
    () => [
      {
        '#e': [id], // Use the post ID to filter reactions, reposts, and zaps
        kinds: [EventKind.Reaction, EventKind.Repost, EventKind.ZapReceipt], // Include all event types
      },
    ],
    [id]
  );

  // Fetch reactions, reposts, and zaps for the given post ID if toggle is enabled
  const { events: reactionEvents } = useSubscribe({
    filters,
  });

  // Update the reaction, repost, and zap counts and cache if new events are fetched
  useEffect(() => {
    if (toggle && reactionEvents.length > 0) {
      async function updateReactionCache() {
        // Count reactions, reposts, and zaps
        const newReactionCount = reactionEvents.filter(
          (event) => event.kind === EventKind.Reaction
        ).length;
        const newRepostCount = reactionEvents.filter(
          (event) => event.kind === EventKind.Repost
        ).length;
        let newZapCount = 0;
        reactionEvents
          .filter((event) => event.kind === EventKind.ZapReceipt)
          .forEach((event) => {
            const ln = event.tags.find((t) => t[0] === 'bolt11')?.[1];
            if (ln) {
              newZapCount += getLightningAmount(ln) || 0;
            }
          });

        // Cache the counts
        await reactionCache.set(`${id}.reactions`, String(newReactionCount));
        await reactionCache.set(`${id}.reposts`, String(newRepostCount));
        await reactionCache.set(`${id}.zaps`, String(newZapCount));

        // Update state with new counts
        setReactionCount(newReactionCount);
        setRepostCount(newRepostCount);
        setZapCount(newZapCount);
        setToggle(false); // Disable fetching after updating cache
      }
      updateReactionCache();
    }
  }, [reactionEvents, id, toggle]); // Ensure to include postId in the dependency array

  return {
    reactionCount: reactionCount || 0,
    repostCount: repostCount || 0, // Return the repost count
    zapCount: zapCount || 0, // Return the zap count
  };
};

const ActionItem = ({ icon, count, size }: { icon: any; count: string; size: number }) => (
  <HStack align="center" className="bg-transparent" spacing={4}>
    {icon}
    <Text size={size - 2} weight="bold" className="text-primary-400">
      {count}
    </Text>
  </HStack>
);

export function ActionItems({
  reactionCount,
  repostCount,
  zapCount,
  size = 24,
}: {
  reactionCount: number;
  repostCount: number;
  zapCount: number;
  size: number;
}) {
  return (
    <HStack
      justify="space-between"
      className="bg-transparent"
      style={{
        marginLeft: size === 16 ? 56 : 0,
      }}>
      <ActionItem
        size={size}
        icon={
          <Icon
            name="garden:speech-bubble-typing-fill-12"
            size={size - 4}
            className="text-primary-400"
          />
        }
        count={formatNumber(0)}
      />
      <ActionItem
        size={size}
        icon={
          <Icon name="garden:arrow-retweet-fill-16" size={size - 4} className="text-primary-400" />
        }
        count={formatNumber(repostCount)}
      />
      <ActionItem
        size={size}
        icon={<Icon name="garden:heart-fill-16" size={size - 4} className="text-primary-400" />}
        count={formatNumber(reactionCount)}
      />
      <ActionItem
        size={size}
        icon={<Icon name="mingcute:lightning-fill" size={size - 4} className="text-primary-400" />}
        count={formatNumber(zapCount)}
      />
    </HStack>
  );
}
