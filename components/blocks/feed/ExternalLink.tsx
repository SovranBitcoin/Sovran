import React, { useState, useEffect } from 'react';
import { View } from 'react-native';
import { Text } from 'components/ui/Text';
import { getLinkPreview as getPreview } from 'link-preview-js';
import { Cache } from 'react-native-cache';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CachedImage from 'components/ui/Image';

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

const LinkImage = ({ linkData }: { linkData: any }) =>
  linkData?.images?.find((image: string) => image.endsWith('.png')) && (
    <CachedImage
      className="bg-primary-800 h-[100px] w-auto rounded-lg"
      source={{ uri: linkData.images.find((image: string) => image.endsWith('.png')) }}
    />
  );

const LinkDetails = ({ url, linkData }: { url: string; linkData: any }) => (
  <View>
    <Text size={12} className="text-primary-300 mt-1">
      {url}
    </Text>
    <Text weight="heavy" className="text-primary-0">
      {linkData?.title}
    </Text>
    <Text size={12} className="text-primary-200">
      {linkData?.description}
    </Text>
  </View>
);

export const ExternalLink = ({ url }: { url: string }) => {
  const { loading, linkData, error } = useLinkPreview(url);

  if (loading) {
    return <View />;
  }

  if (error) {
    return null;
  }

  return (
    <View className="bg-primary-700 mb-3 rounded-2xl p-3">
      <LinkImage linkData={linkData} />
      <LinkDetails url={url} linkData={linkData} />
    </View>
  );
};
