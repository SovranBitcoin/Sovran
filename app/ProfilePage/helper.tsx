import { useEffect, useMemo, useState } from 'react';
import { eventKind } from 'nostr-fetch';
import { useNostrEvents as useNE } from 'nostr-react';
import { EventKind } from '../../app/Profile';
import AsyncStorage from '@react-native-async-storage/async-storage'; // Assuming you're using AsyncStorage as backend for cache
import { Cache } from 'react-native-cache';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { extractUrls } from './TextContent';

export const useNostrEvents = (authors, ids, kinds, type) => {
  const [since, setSince] = useState(Math.floor(Date.now() / 1000));

  // Helper function to categorize events
  const categorizeEvent = (event) => {
    const isMetadata = event.kind === EventKind.Metadata;
    const hasRootTag = event.kind === eventKind.text || event.kind === eventKind.repost;
    const hasReplyTag = event.tags.some((tag) => tag[3] === 'reply');
    const hasMediaTag = extractUrls(event.content)?.urls?.length > 0;

    let categories = [];
    if (isMetadata) {
      categories.push('metadata');
    }
    if (hasRootTag && !hasReplyTag) {
      categories.push('post');
    }
    if (hasReplyTag) {
      categories.push('reply');
    }
    if (hasMediaTag) {
      categories.push('media');
    }
    return categories;
  };

  const filters = useMemo(
    () => [
      {
        kinds,
        '#e': ids,
        authors: ids?.length ? undefined : authors,
        // until: ids?.length ? undefined : since,
        // since: ids?.length ? 0 : since - 24 * 60 * 60 * 1,
      },
    ],
    []
  );
  const { events, isLoading } = useSubscribe({
    filters,
  });

  const sortedEvents = useMemo(
    () => events.sort((a, b) => b.created_at! - a.created_at!),
    [events]
  );

  const { events: metadataEvents } = useNE({
    filter: {
      kinds: [EventKind.Metadata],
      authors,
      since: 0,
    },
  });

  const metadata = metadataEvents.filter((event) => categorizeEvent(event).includes('metadata'));
  // Filter the events into posts, replies, and media
  const posts = sortedEvents
    .filter((event) => categorizeEvent(event).includes('post'))
    .map((e) => {
      return {
        ...e,
        // profile: JSON.parse(metadataEvents?.[0]?.content || '{}')
      };
    });

  const replies = sortedEvents
    .filter((event) => categorizeEvent(event).includes('reply'))
    .map((e) => {
      return {
        ...e,
        // profile: JSON.parse(metadataEvents?.[0]?.content || '{}')
      };
    });
  const media = sortedEvents
    .filter((event) => categorizeEvent(event).includes('media'))
    .map((e) => {
      return {
        ...e,
        // profile: JSON.parse(metadataEvents?.[0]?.content || '{}')
      };
    });

  // Check if a specific type of event is found
  const hasDesiredEventType = (type) => {
    if (type === 'posts') return posts.length > 0;
    if (type === 'replies') return replies.length > 0;
    if (type === 'media') return media.length > 0;
    return false;
  };

  // Recursive fetch logic with retries and check for specific event types
  const fetchMore = (retryCount = 0, maxRetries = 7) => {
    if (!isLoading) {
      const previousEventCount = sortedEvents.length;
      setSince((prevSince) => prevSince - 24 * 60 * 60 * 1);

      // Wait until the next fetch has completed, then check if new events were added
      setTimeout(() => {
        if (sortedEvents.length === previousEventCount && retryCount < maxRetries) {
          // No new events, try again
          fetchMore(retryCount + 1, maxRetries);
        } else if (!hasDesiredEventType(type) && retryCount < maxRetries) {
          // If no desired type of event is found, try again
          fetchMore(retryCount + 1, maxRetries);
        }
      }, 500); // Small delay to allow events to load
    }
  };

  return {
    posts,
    replies,
    media,
    loading: isLoading,
    nextDateRange: {
      since: since - 24 * 60 * 60 * 1,
      until: since - 24 * 60 * 60 * 1 - 24 * 60 * 60 * 1,
    },
    fetchMore,
  };
};

const myCache = new Cache({
  namespace: 'profiles',
  policy: {
    maxEntries: 100,
    stdTTL: 24 * 60 * 60, // 24 hours TTL in seconds
  },
  backend: AsyncStorage,
});

export function useNostrProfile({ id }) {
  const [profile, setProfile] = useState(null);
  const [toggle, setToggle] = useState(false);

  // Check cache for existing profile data
  useEffect(() => {
    async function checkCache() {
      const cachedProfile = await myCache.get(`${id}.profile`);
      if (!!cachedProfile) {
        setProfile(cachedProfile);
      } else {
        setToggle(true); // Only set toggle once when the cache is empty
      }
    }
    checkCache();
  }, [id]); // Run only when `id` changes

  // Fetch Nostr profile if toggle is enabled
  const { events: metaEvents } = useNE({
    filter: { authors: [id], kinds: [EventKind.Metadata] },
    enabled: toggle, // Only enable fetching if the toggle is set
  });

  // Update profile state and cache if new metadata is available
  useEffect(() => {
    if (toggle && metaEvents.length > 0) {
      async function fetchProfile() {
        const profileData = JSON.parse(metaEvents[0]?.content); // Assuming first event is profile metadata
        if (!!profileData) {
          await myCache.set(`${id}.profile`, profileData); // Cache profile data
          setProfile(profileData); // Set profile in state
          setToggle(false); // Disable fetching after profile is cached
        }
      }
      fetchProfile();
    }
  }, [metaEvents, id, toggle]); // Ensure to include `id` in the dependency array

  return profile;
}
