import React, { useState } from 'react';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { useSelector } from 'react-redux';
import HighlightText from '@sanar/react-native-highlight-text';
import { greys, shades } from 'helper/colors';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { memoizedGetTheme } from 'helper/redux/settings';

export const extractUrls = (text) => {
  try {
    const urlRegex = /(https:\/\/[^\s]+)/g;
    const nostrRegex = /(nostr:(note1[^\s]+|nevent1[^\s]+))/g;

    const urls = text.match(urlRegex) || [];
    const nostrEvents = text.match(nostrRegex) || [];

    const contentWithoutUrls = text.replace(urlRegex, '').replace(nostrEvents, '');

    return { urls, nostrEvents, contentWithoutUrls };
  } catch {
    return { urls: null, nostrEvents: null, contentWithoutUrls: text };
  }
};

export function TextContent({ content, length = 200, fontSize = 14 }) {
  const theme = useSelector(memoizedGetTheme);

  const extractHashtags = (text) => {
    try {
      const hashtagRegex = /#\w+/g;
      const hashtags = text.match(hashtagRegex) || [];
      return hashtags;
    } catch {
      return [];
    }
  };

  const extractMentions = (text) => {
    try {
      const mentionsRegex = /nostr:npub1\w+/g;
      const mentions = text.match(mentionsRegex) || [];
      return mentions;
    } catch {
      return [];
    }
  };

  const [showFullText, setShowFullText] = useState(false);

  const { contentWithoutUrls } = extractUrls(content);
  const hashtags = extractHashtags(content);
  const mentions = extractMentions(content);

  const truncatedText = contentWithoutUrls
    ?.replace(/\s+$/, '')
    ?.replace(/\n+$/, '')
    ?.slice(0, length); // Truncate text to 200 chars

  return (
    <View
      style={{
        backgroundColor: 'transparent',
      }}>
      <HighlightText
        style={{
          fontFamily: 'OverpassRegular',
          fontSize,
          color: greys(theme)[0],
          marginBottom: 8,
        }}
        highlightStyle={{
          fontFamily: 'OverpassHeavy',
          color: shades[300],
        }}
        searchWords={[...hashtags, ...mentions]}
        textToHighlight={
          showFullText
            ? contentWithoutUrls?.replace(/\s+$/, '')?.replace(/\n+$/, '')
            : truncatedText + (contentWithoutUrls?.length > 200 ? '...' : '')
        }
      />
      {contentWithoutUrls?.length > 200 && (
        <TouchableOpacity onPress={() => setShowFullText(!showFullText)}>
          <Text
            style={{
              fontFamily: 'OverpassBold',
              fontSize,
              color: shades[300],
              marginBottom: 4,
              textAlign: 'right',
            }}>
            {showFullText ? 'Show less' : 'Show more'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
