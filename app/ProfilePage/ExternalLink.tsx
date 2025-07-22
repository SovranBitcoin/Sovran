import React, { useState, useEffect } from 'react';
import { View } from 'react-native';
import { useSelector } from 'react-redux';
import { greys, Theme } from 'helper/colors';
import { Text } from 'components/common/Text';
import { getLinkPreview as getPreview } from 'link-preview-js';
import { Cache } from 'react-native-cache';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CachedImage from 'components/common/Image';
import { memoizedGetTheme } from 'helper/redux/settings';

type LinkPreviewData =
  | {
      url: string;
      title: string;
      siteName: string | undefined;
      description: string | undefined;
      mediaType: string;
      contentType: string | undefined;
      images: string[];
      videos: {
        url: string | undefined;
        secureUrl: string | null | undefined;
        type: string | null | undefined;
        width: string | undefined;
        height: string | undefined;
      }[];
      favicons: string[];
    }
  | {
      charset: string | null;
      url: string;
      mediaType: string;
      contentType: string;
      favicons: string[];
    }
  | {
      charset: string | null;
      url: string;
      title: string;
      siteName: string | undefined;
      description: string | undefined;
      mediaType: string;
      contentType: string | undefined;
      images: string[];
      videos: {
        url: string | undefined;
        secureUrl: string | null | undefined;
        type: string | null | undefined;
        width: string | undefined;
        height: string | undefined;
      }[];
      favicons: string[];
    };

function getLinkPreview(url: string): Promise<LinkPreviewData> {
  return getPreview(url);
}

const linkPreviewCache = new Cache({
  namespace: 'linkPreviews',
  policy: {
    maxEntries: 100,
    stdTTL: 60 * 60 * 24, // 24 hours TTL in seconds
  },
  backend: AsyncStorage,
});

const useLinkPreview = (url: string) => {
  const [loading, setLoading] = useState(true);
  const [linkData, setLinkData] = useState<LinkPreviewData>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const fetchLinkPreview = async () => {
      if (!url) return;

      try {
        // Check the cache for existing link preview data
        const cachedLinkData = await linkPreviewCache.get(url);

        if (cachedLinkData) {
          // If cached data exists, use it
          setLinkData(JSON.parse(cachedLinkData));
          setLoading(false);
        } else {
          // If no cached data, fetch it from the server
          const data = await getLinkPreview(url);
          setLinkData(data);

          // Cache the fetched data
          await linkPreviewCache.set(url, JSON.stringify(data));
        }
      } catch {
        setError('Failed to fetch link preview.');
      } finally {
        setLoading(false);
      }
    };

    fetchLinkPreview();
  }, [url]);

  return { loading, linkData, error };
};

const LinkImage = ({ theme, linkData }: { theme: Theme; linkData: any }) =>
  linkData?.images?.find((image: string) => image.endsWith('.png')) && (
    <CachedImage
      style={{
        width: 'auto',
        height: 100,
        backgroundColor: greys(theme)[800],
        borderRadius: 8,
      }}
      source={{ uri: linkData.images.find((image: string) => image.endsWith('.png')) }}
    />
  );

const LinkDetails = ({ theme, url, linkData }: { theme: Theme; url: string; linkData: any }) => (
  <View>
    <Text
      size={12}
      style={{
        color: greys(theme)[300],
        marginTop: 4,
      }}>
      {url}
    </Text>
    <Text
      weight="heavy"
      style={{
        color: greys(theme)[0],
      }}>
      {linkData?.title}
    </Text>
    <Text
      size={12}
      style={{
        color: greys(theme)[200],
      }}>
      {linkData?.description}
    </Text>
  </View>
);

export const ExternalLink = ({ url }: { url: string }) => {
  const theme = useSelector(memoizedGetTheme);
  const { loading, linkData, error } = useLinkPreview(url);

  if (loading) {
    return <View />;
  }

  if (error) {
    return null;
  }

  return (
    <View
      style={{
        backgroundColor: greys(theme)[700],
        borderRadius: 16,
        padding: 12,
        marginBottom: 12,
      }}>
      <LinkImage theme={theme} linkData={linkData} />
      <LinkDetails theme={theme} url={url} linkData={linkData} />
    </View>
  );
};
