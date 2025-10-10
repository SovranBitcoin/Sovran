import React, { useState, useMemo } from 'react';
import { View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import HighlightText from '@sanar/react-native-highlight-text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { nip19 } from 'nostr-tools';
import { useNostrProfile } from './useNostrProfile';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { Metadata } from 'nostr-tools/kinds';
import { useTheme } from 'providers/ThemeProvider';

export const extractUrls = (text: string) => {
  try {
    const urlRegex = /(https:\/\/[^\s]+)/g;
    const nostrRegex = /(nostr:(note1[^\s]+|nevent1[^\s]+|nprofile1[^\s]+|npub1[^\s]+))/g;

    const urls = text.match(urlRegex) || [];
    const nostrEvents = text.match(nostrRegex) || [];

    // Remove all URLs and nostr events from the text
    let contentWithoutUrls = text.replace(urlRegex, '');
    contentWithoutUrls = contentWithoutUrls.replace(nostrRegex, '');

    return { urls, nostrEvents, contentWithoutUrls };
  } catch {
    return { urls: null, nostrEvents: null, contentWithoutUrls: text };
  }
};

// Component to render text with nostr profile references
const NostrProfileReference = ({ nostrRef }: { nostrRef: string }) => {
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [relays, setRelays] = useState<string[]>([]);

  React.useEffect(() => {
    try {
      const { type, data } = nip19.decode(nostrRef.replace('nostr:', ''));
      if (type === 'nprofile') {
        // nprofile contains both pubkey and relays
        const decodedPubkey = data.pubkey;
        const decodedRelays = data.relays || [];
        setPubkey(decodedPubkey);
        setRelays(decodedRelays);
      } else if (type === 'npub') {
        // npub only contains pubkey, use default relays
        const decodedPubkey = typeof data === 'string' ? data : (data as any).pubkey;
        setPubkey(decodedPubkey);
        setRelays([]); // Will use default relays from NDK
      }
    } catch (e) {
      console.log('Failed to decode nostr reference:', nostrRef, e);
    }
  }, [nostrRef]);

  // Use useSubscribe to fetch profile from specific relays
  const filters = useMemo(
    () => [
      {
        authors: pubkey ? [pubkey] : [],
        kinds: [Metadata],
        limit: 1,
      },
    ],
    [pubkey]
  );

  const { events } = useSubscribe({
    filters,
    relays: relays.length > 0 ? relays : undefined, // Use specific relays if available
  });

  // Get profile from cache first
  const cachedProfile = useNostrProfile({ id: pubkey || '' });

  const displayName = useMemo(() => {
    if (!pubkey) return 'Loading...';

    // First try to get from existing profile cache
    if (cachedProfile) {
      return (
        (cachedProfile as any)?.displayName ||
        (cachedProfile as any)?.profile?.displayName ||
        (cachedProfile as any)?.display_name ||
        (cachedProfile as any)?.profile?.display_name ||
        (cachedProfile as any)?.name ||
        (cachedProfile as any)?.profile?.name ||
        'Unknown User'
      );
    }

    // If not in cache, try to parse from fetched events
    const latestEvent = events.reduce((latest: any, current: any) => {
      return latest?.created_at > current?.created_at ? latest : current;
    }, null);

    if (latestEvent?.content) {
      try {
        const metadata = JSON.parse(latestEvent.content);
        return metadata.display_name || metadata.displayName || metadata.name || 'Unknown User';
      } catch (e) {
        console.log('Failed to parse profile metadata:', e);
      }
    }

    return 'Loading...';
  }, [pubkey, events, cachedProfile]);

  return (
    <Text
      className="text-primary-400"
      style={{
        fontWeight: 'bold',
      }}>
      @{displayName}
    </Text>
  );
};

// Function to split text and render nostr references
const renderTextWithNostrProfiles = (text: string) => {
  const nostrProfileRegex = /(nostr:(nprofile1[^\s]+|npub1[^\s]+))/g;
  const parts = text.split(nostrProfileRegex);

  return parts.map((part, index) => {
    if (part.match(nostrProfileRegex)) {
      return <NostrProfileReference key={index} nostrRef={part} />;
    }
    return part;
  });
};

export function TextContent({
  content,
  length = 200,
  fontSize = 14,
}: {
  content: string;
  length?: number;
  fontSize?: number;
}) {
  const [showFullText, setShowFullText] = useState(false);
  const { getShadeColor } = useTheme();

  const { contentWithoutUrls } = extractUrls(content);

  const truncatedText = contentWithoutUrls
    ?.replace(/\s+$/, '')
    ?.replace(/\n+$/, '')
    ?.slice(0, length);

  const displayText = showFullText
    ? contentWithoutUrls?.replace(/\s+$/, '')?.replace(/\n+$/, '')
    : truncatedText + (contentWithoutUrls?.length > 200 ? '...' : '');

  // Check if content has nostr profile references
  const hasNostrProfiles = /nostr:(nprofile1[^\s]+|npub1[^\s]+)/.test(displayText || '');

  return (
    <View>
      {hasNostrProfiles ? (
        <Text
          className="mb-2 text-primary-0"
          style={{
            fontFamily: 'OverpassRegular',
            fontSize,
            lineHeight: fontSize * 1.4,
          }}>
          {renderTextWithNostrProfiles(displayText || '')}
        </Text>
      ) : (
        <HighlightText
          className="mb-2 text-primary-0"
          style={{
            fontFamily: 'OverpassRegular',
            fontSize,
          }}
          highlightStyle={{
            fontFamily: 'OverpassHeavy',
            color: getShadeColor('300'),
          }}
          // @ts-ignore: HighlightText does not type 'searchWords', but it works
          searchWords={[...(content.match(/#\w+/g) || []), ...(content.match(/@\w+/g) || [])]}
          textToHighlight={displayText}
        />
      )}
      {contentWithoutUrls?.length > 200 && (
        <TouchableOpacity onPress={() => setShowFullText(!showFullText)}>
          <Text
            className="mb-1 text-right text-primary-300"
            style={{
              fontFamily: 'OverpassBold',
              fontSize,
            }}>
            {showFullText ? 'Show less' : 'Show more'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
