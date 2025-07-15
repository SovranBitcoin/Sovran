import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Text } from 'components/common/Text';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import emoji from 'emoji-dictionary'; // Import the emoji dictionary package
import { EventKind } from './Profile';
import { FlashList } from '@shopify/flash-list';
import Image from 'components/common/Image';
import PagerView from 'react-native-pager-view';
import { Tabs } from 'components/common/Tabs';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { memoizedGetTheme } from 'helper/redux/settings';

export function UserNameProfiles({ pubkey, style }: { pubkey: string; style: any }) {
  const filters = useMemo(
    () => [
      {
        authors: [pubkey], // Filter profiles based on the provided pubkey
        kinds: [EventKind.Metadata], // Fetch metadata (profile details)
        limit: 1,
      },
    ],
    [pubkey]
  );

  const { events } = useSubscribe({ filters });

  const displayName = useMemo(() => {
    const latestEvent = events.reduce((latest: any, current: any) => {
      return latest?.created_at > current?.created_at ? latest : current;
    }, null);

    if (latestEvent?.content) {
      try {
        const metadata = JSON.parse(latestEvent.content);
        return metadata.displayName || metadata.name || 'Unknown User'; // Extract name or fallback
      } catch {}
    }
    return 'Unknown User';
  }, [events]);

  return <Text style={style}>{displayName}</Text>;
}

export function UserReactionProfiles({ pubkey, isOverlapping = true }: { pubkey: string }) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const filters = useMemo(
    () => [
      {
        authors: [pubkey], // Filter profiles based on the provided pubkey
        kinds: [EventKind.Metadata], // Fetch metadata (profile details)
        limit: 1,
      },
    ],
    [pubkey]
  );

  const { events } = useSubscribe({ filters });

  const profilePicture = useMemo(() => {
    const latestEvent = events.reduce((latest: any, current: any) => {
      return latest?.created_at > current?.created_at ? latest : current;
    }, null);

    if (latestEvent?.content) {
      try {
        const metadata = JSON.parse(latestEvent.content);
        return metadata.picture; // Extract profile picture URL
      } catch {}
    }
    return null;
  }, [events]);

  if (!profilePicture) return null;

  return (
    <View style={[styles.profilePictureWrapper, isOverlapping && styles.overlappingProfile]}>
      <Image source={{ uri: profilePicture }} style={styles.profilePicture} />
    </View>
  );
}

function ReactionProfiles({ reactions }: { reactions: any[] }) {
  const theme = useSelector((state: any) => state.settings?.settings?.theme);
  const styles = createStyles(theme);

  const maxProfiles = 8;
  const displayedReactions = reactions.slice(0, maxProfiles);
  const remainingCount = reactions.length - maxProfiles;

  return (
    <View style={styles.reactionRow}>
      {displayedReactions.map((reaction, index) => (
        <UserReactionProfiles key={reaction.pubkey} pubkey={reaction.pubkey} />
      ))}
      {remainingCount > 0 && (
        <View style={[styles.profilePictureWrapper, styles.moreCircle, styles.overlappingProfile]}>
          <Text style={styles.moreText}>+{remainingCount}</Text>
        </View>
      )}
    </View>
  );
}

const TabTwoScreen = () => {
  const theme = useSelector((state: any) => state.settings?.settings?.theme);
  const styles = createStyles(theme);

  const since = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60 * 1;

  const filters = useMemo(
    () => [
      {
        '#p': ['1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2'], // Filter reactions, reposts, and zaps
        kinds: [EventKind.Reaction, EventKind.Repost, EventKind.ZapReceipt],
        since: since - 30 * day,
      },
      {
        authors: ['1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2'], // Filter the user's notes
        kinds: [EventKind.TextNote, EventKind.Repost, 30023],
        since: since - 30 * day,
      },
    ],
    []
  );

  const { events, isLoading } = useSubscribe({ filters });

  // Parse events into categories
  const { reactionEvents, repostEvents, zapEvents, noteEvents } = useMemo(() => {
    const reactionEvents = events.filter((event: any) => event.kind === EventKind.Reaction);

    const repostEvents = events.filter((event: any) => event.kind === EventKind.Repost);

    const zapEvents = events.filter((event: any) => event.kind === EventKind.ZapReceipt);

    const noteEvents = events.filter(
      (event: any) =>
        event.kind === EventKind.TextNote || event.kind === EventKind.Repost || event.kind === 30023
    );

    return { reactionEvents, repostEvents, zapEvents, noteEvents };
  }, [events]);

  const groupedReactions = useMemo(() => {
    const groups: Record<string, any[]> = {};

    reactionEvents.forEach((event: any) => {
      const eventId = event.tags.find(([key]: [string, string]) => key === 'e')?.[1];

      if (eventId) {
        if (!groups[eventId]) {
          groups[eventId] = [];
        }
        groups[eventId].push(event);
      }
    });

    return groups;
  }, [reactionEvents]);

  const groupedReposts = useMemo(() => {
    const groups: Record<string, any[]> = {};
    repostEvents.forEach((event: any) => {
      const eventId = event.tags.find(([key]: [string, string]) => key === 'e')?.[1];

      if (eventId) {
        if (!groups[eventId]) {
          groups[eventId] = [];
        }
        groups[eventId].push(event);
      }
    });

    return groups;
  }, [repostEvents]);

  const groupedZaps = useMemo(() => {
    const groups: Record<string, any[]> = {};
    zapEvents.forEach((event: any) => {
      const eventId = event.tags.find(([key]: [string, string]) => key === 'e')?.[1];

      if (eventId) {
        if (!groups[eventId]) {
          groups[eventId] = [];
        }
        groups[eventId].push(event);
      }
    });

    return groups;
  }, [zapEvents]);

  const getEventKind = (event) => {
    switch (event.kind) {
      case EventKind.TextNote: {
        return { noun: 'note', verb: 'noted to' };
      }
      case EventKind.Repost: {
        return { noun: 'repost', verb: 'reposted' };
      }
      case 30023: {
        return { noun: 'long post', verb: 'wrote a long post to' };
      }
      case EventKind.Reaction: {
        return { noun: 'reaction', verb: 'reacted to' };
      }
      case EventKind.ZapReceipt: {
        return { noun: 'zap', verb: 'zapped' };
      }
      default: {
        return { noun: 'action', verb: 'performed an action' }; // Default fallback
      }
    }
  };

  const getEvent = (event) => {
    if (typeof event.content === 'string') {
      try {
        const parsed = JSON.parse(event.content);
        return parsed;
      } catch {
        // Not a valid JSON string, return the original content
        return event;
      }
    }

    return event;
  };

  const getPersonCountLabel = (count) => {
    return count === 1 ? 'person' : 'people';
  };

  const renderEventContent = (event: any, reactions) => {
    if (event) {
      const event_ = getEvent(event);
      const { content, id, created_at, kind } = event_;

      const notificationKind = reactions[0].kind;
      const date = new Date(created_at * 1000).toLocaleString();

      return (
        <>
          <Text style={styles.reactionCount}>
            {reactions.length} {getPersonCountLabel(reactions.length)}{' '}
            {getEventKind(reactions[0]).verb} your {getEventKind(event_).noun}
          </Text>
          <View style={styles.reactionRow}>
            <ReactionProfiles reactions={reactions} />
          </View>

          {notificationKind === EventKind.Reaction && (
            <View style={{ display: 'flex', flexDirection: 'row', marginBottom: 8 }}>
              {renderReactions(reactions)}
            </View>
          )}
          <View key={id} style={styles.eventCard}>
            {content && (
              <Text style={styles.eventContent}>
                {content.slice(0, 100)}
                {content.length !== content.slice(0, 100).length ? '...' : ''}
              </Text>
            )}
            <Text style={styles.eventDate}>{date}</Text>
          </View>
        </>
      );
    }
    return null;
  };

  const renderReactions = (reactions: any[]) => {
    const reactionCountMap = reactions.reduce((acc: any, reaction: any) => {
      const { content, id } = reaction;
      const emojiContent = emoji.getUnicode(content.replace(/-/g, '_')) || content;

      if (acc[emojiContent]) {
        acc[emojiContent].count++;
        acc[emojiContent].ids.push(id);
      } else {
        acc[emojiContent] = { count: 1, ids: [id] };
      }
      return acc;
    }, {});

    return Object.keys(reactionCountMap).map((emojiContent) => {
      const { count } = reactionCountMap[emojiContent];
      return (
        <View key={emojiContent} style={styles.reactionCard}>
          <View style={styles.reactionContent}>
            <Text
              style={{
                color: 'white',
              }}>
              {emojiContent}
            </Text>
            <Text style={{ color: 'white', marginLeft: 8 }}>{count}</Text>
          </View>
        </View>
      );
    });
  };

  const renderItem = ({ item }: { item: [string, any[]] }) => {
    const [eventId, reactions] = item;
    const event = noteEvents.find(
      (e: any) => e.tags.find(([key]: [string, string]) => key === 'e')?.[1] === eventId
    );

    return <View key={eventId}>{renderEventContent(event, reactions)}</View>;
  };

  const pagerRef = useRef(null);
  const [selectedTab, setSelectedTab] = useState('Reactions');
  const tabs = ['Reactions', 'Reposts', 'Zaps'];

  const onPageSelected = useCallback((event) => {
    const pageIndex = event.nativeEvent.position;
    setSelectedTab(tabs[pageIndex]);
  }, []);

  const handleTabPress = (tab, index) => {
    setSelectedTab(tab);
    pagerRef.current?.setPage(index);
  };

  return (
    <View style={styles.container}>
      <View>
        <Tabs tabs={tabs} selectedTab={selectedTab} handleTabPress={handleTabPress} />
      </View>
      {isLoading ? (
        <Text style={styles.loadingText}>Loading...</Text>
      ) : (
        <PagerView
          ref={pagerRef}
          onPageSelected={onPageSelected}
          style={{
            height: Dimensions.get('window').height - 200,
            backgroundColor: 'transparent',
          }}
          initialPage={0}>
          <View
            key="1"
            style={{
              flex: 1,
              backgroundColor: greys(theme)[950],
              height: '100%',
              overflow: 'hidden',
            }}>
            <FlashList
              data={Object.entries(groupedReactions)}
              renderItem={renderItem}
              keyExtractor={([eventId]) => eventId}
              estimatedItemSize={100}
            />
          </View>
          <View
            key="1"
            style={{
              flex: 1,
              backgroundColor: greys(theme)[950],
              height: '100%',
              overflow: 'hidden',
            }}>
            <FlashList
              data={Object.entries(groupedReposts)}
              renderItem={renderItem}
              keyExtractor={([eventId]) => eventId}
              estimatedItemSize={100}
            />
          </View>
          <View
            key="2"
            style={{
              flex: 1,
              backgroundColor: greys(theme)[950],
              height: '100%',
              overflow: 'hidden',
            }}>
            <FlashList
              data={Object.entries(groupedZaps)}
              renderItem={renderItem}
              keyExtractor={([eventId]) => eventId}
              estimatedItemSize={100}
            />
          </View>
        </PagerView>
      )}
    </View>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      backgroundColor: greys(theme)[950],
      flex: 1,
      padding: 16,
    },
    scrollContainer: {
      marginTop: 8,
    },
    eventCard: {
      backgroundColor: greys(theme)[800],
      borderRadius: 8,
      padding: 8,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: greys(theme)[700],
    },
    eventContent: {
      color: greys(theme)[0],
      fontSize: 16,
      marginBottom: 8,
    },
    eventDate: {
      color: greys(theme)[200],
      fontSize: 12,
    },
    loadingText: {
      color: greys(theme)[0],
      fontSize: 16,
      textAlign: 'center',
      marginTop: 20,
    },
    reactionCount: {
      color: greys(theme)[100],
      fontSize: 14,
      marginBottom: 8,
      marginTop: 12,
    },
    reactionCard: {
      backgroundColor: greys(theme)[800],
      borderRadius: 50,
      padding: 8,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
      borderWidth: 1,
      borderColor: greys(theme)[700],
    },
    reactionContent: {
      flexDirection: 'row',
    },
    reactionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
      paddingLeft: 6,
    },
    profilePictureWrapper: {
      position: 'relative',
    },
    overlappingProfile: {
      marginLeft: -12, // Adjust this value for the amount of overlap
    },
    profilePicture: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 2, // Optional: Add a border for better visibility
      borderColor: greys(theme)[500],
    },
    moreCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: greys(theme)[700],
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: greys(theme)[500],
    },
    moreText: {
      color: greys(theme)[0],
      fontSize: 14,
      fontWeight: 'bold',
    },
  });

export default withSheetProvider(TabTwoScreen);
