import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { CommentIcon, HeartIcon, RepostIcon, ZapIcon } from 'assets/icons';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { EventKind } from '../../app/Profile';
import AsyncStorage from '@react-native-async-storage/async-storage'; // Assuming you're using AsyncStorage as backend for cache
import { Cache } from 'react-native-cache';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { getLightningAmount } from 'helper/cashuClient';

const reactionCache = new Cache({
  namespace: 'reactions',
  policy: {
    maxEntries: 100,
    stdTTL: 60 * 5, // 24 hours TTL in seconds
  },
  backend: AsyncStorage,
});

export const usePostReactions = ({ id }) => {
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
  const { events: reactionEvents, isLoading } = useSubscribe({
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
              newZapCount += getLightningAmount({ pr: ln });
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
    loading: isLoading,
  };
};

const ActionItem = ({ Icon, count, theme, size }) => (
  <View
    style={{
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'transparent',
    }}>
    <Icon size={size} color={greys(theme)[400]} />
    <Text
      size={size}
      weight="bold"
      style={{
        color: greys(theme)[400],
        marginLeft: 4,
      }}>
      {count}
    </Text>
  </View>
);

export function ActionItems({ reactionCount, repostCount, zapCount, size = 24 }) {
  const theme = useSelector(memoizedGetTheme);

  function formatNumber(num) {
    if (num >= 1000000000) {
      return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + 'b';
    } else if (num >= 1000000) {
      return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    } else {
      return num.toString();
    }
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        marginLeft: size === 16 ? 56 : 0,
        justifyContent: 'space-between',
        backgroundColor: 'transparent',
      }}>
      <ActionItem size={size} Icon={CommentIcon} count={formatNumber(0)} theme={theme} />
      <ActionItem size={size} Icon={RepostIcon} count={formatNumber(repostCount)} theme={theme} />
      <ActionItem size={size} Icon={HeartIcon} count={formatNumber(reactionCount)} theme={theme} />
      <ActionItem size={size} Icon={ZapIcon} count={formatNumber(zapCount)} theme={theme} />
    </View>
  );
}
