import { View } from "react-native";
import { useState, useEffect } from "react";
import { useSelector } from "react-redux";
import { greys } from "helper/colors";
import { Text } from "components/common/Themed";
import { getLinkPreview } from "link-preview-js";
import { Cache } from "react-native-cache";
import AsyncStorage from "@react-native-async-storage/async-storage";
import CachedImage from "components/common/Image";
import { memoizedGetTheme } from "helper/redux/settings";

const linkPreviewCache = new Cache({
  namespace: "linkPreviews",
  policy: {
    maxEntries: 100,
    stdTTL: 60 * 60 * 24, // 24 hours TTL in seconds
  },
  backend: AsyncStorage,
});

const useLinkPreview = (url) => {
  const [loading, setLoading] = useState(true);
  const [linkData, setLinkData] = useState(null);
  const [error, setError] = useState(null);

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
      } catch (err) {
        setError("Failed to fetch link preview.");
      } finally {
        setLoading(false);
      }
    };

    fetchLinkPreview();
  }, [url]);

  return { loading, linkData, error };
};

const LinkImage = ({ theme, linkData }) =>
  linkData?.images?.find((image) => image.endsWith(".png")) && (
    <CachedImage
      style={{
        width: "auto",
        height: 100,
        backgroundColor: greys(theme)[1800],
        borderRadius: 8,
      }}
      source={{ uri: linkData.images.find((image) => image.endsWith(".png")) }}
    />
  );

const LinkDetails = ({ theme, url, linkData }) => (
  <View>
    <Text
      size={12}
      style={{
        color: greys(theme)[600],
        marginTop: 4,
      }}
    >
      {url}
    </Text>
    <Text
      weight="heavy"
      style={{
        color: greys(theme)[0],
      }}
    >
      {linkData?.title}
    </Text>
    <Text
      size={12}
      style={{
        color: greys(theme)[400],
      }}
    >
      {linkData?.description}
    </Text>
  </View>
);

export const ExternalLink = ({ url }) => {
  const theme = useSelector(memoizedGetTheme);
  const { loading, linkData, error } = useLinkPreview(url);

  if (loading) {
    return (
      <View>{/* <ActivityIndicator size="large" color="#0000ff" /> */}</View>
    );
  }

  if (error) {
    return null;
  }

  return (
    <View
      style={{
        backgroundColor: greys(theme)[1500],
        borderRadius: 16,
        padding: 12,
        marginBottom: 12,
      }}
    >
      <LinkImage theme={theme} linkData={linkData} />
      <LinkDetails theme={theme} url={url} linkData={linkData} />
    </View>
  );
};
