/**
 * UnitPreviewCard — phone-frame mock of the wallet screen backgrounded by a
 * specific wallpaper theme. Shared between the Theme Preview carousel (one
 * card per unit) and the Gallery album cards (one card per album cover).
 */

import React, { useEffect, useState } from 'react';
import { INVARIANT_WHITE, WALLPAPER_PLACEHOLDER } from '@/shared/lib/brandColors';
import { StyleSheet } from 'react-native';
import { PressableFeedback } from 'heroui-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from '@/shared/ui/primitives/Image';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Text } from '@/shared/ui/primitives/Text';
import { backgroundImageThemes } from 'config/backgroundImageThemes';
import { THEMES } from '@/themes';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log } from '@/shared/lib/logger';
import { describeImageLoadError } from '@/shared/lib/imageLoadError';

/** A thumbUrl is only usable if it's a real http(s) URL — empty/whitespace/junk
 *  must fall through to the gradient rather than render a blank `<Image>`. */
function isLikelyImageUrl(url: string | undefined | null): url is string {
  return typeof url === 'string' && /^https?:\/\/\S+/i.test(url.trim());
}

interface UnitPreviewCardProps {
  themeName: string;
  label?: string;
  sublabel?: string;
  badge?: string;
  selected?: boolean;
  width: number;
  height: number;
  onPress?: () => void;
  testID?: string;
}

export const UnitPreviewCard = React.memo(function UnitPreviewCard({
  themeName,
  label,
  sublabel,
  badge,
  selected,
  width,
  height,
  onPress,
  testID,
}: UnitPreviewCardProps) {
  const downloaded = useWallpaperStore((s) => s.downloaded[themeName]);
  // Falls back to the remote catalog thumb so un-downloaded picks still
  // show an image immediately after the user selects them; the full
  // download kicks off later at Apply time.
  const catalogEntry = useWallpaperStore((s) => s.catalog.find((w) => w.themeName === themeName));
  const bundledImage = backgroundImageThemes[themeName];
  const palette = THEMES[themeName as keyof typeof THEMES] as Record<string, string> | undefined;
  // Selection border tracks the wallet's active theme so the picker that
  // configures the theme reflects it, instead of a hardcoded blue that
  // ignores the user's choice.
  const foreground = useThemeColor('foreground');

  // Track a failed remote/local source by URI so a broken thumb falls back to
  // the palette gradient instead of a blank box (and a recycled card with a
  // different thumb retries). Bundled requires can't fail, so they bypass this.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const rawThumbUrl = catalogEntry?.thumbUrl;
  const downloadedLocalUri = downloaded?.localUri;
  const hasBundledImage = !!bundledImage;
  const hasCatalogEntry = !!catalogEntry;
  const hasDownloaded = !!downloaded;
  const hasPalette = !!palette;
  const remoteThumb = isLikelyImageUrl(rawThumbUrl) ? rawThumbUrl.trim() : undefined;
  const uriSource = downloadedLocalUri ?? remoteThumb;
  const useDownloadedUri =
    hasDownloaded && !!downloadedLocalUri && downloadedLocalUri !== failedUri;
  const useBundledImage = !hasDownloaded && hasBundledImage;
  const useRemoteUri = !useBundledImage && !!remoteThumb && remoteThumb !== failedUri;
  const imageSource = useDownloadedUri
    ? { uri: downloadedLocalUri }
    : useBundledImage
      ? bundledImage
      : useRemoteUri
        ? { uri: remoteThumb }
        : null;
  const hasImageSource = !!imageSource;
  const sourceKind =
    useDownloadedUri || hasDownloaded
      ? 'downloaded-file'
      : useBundledImage
        ? 'bundled-require'
        : remoteThumb
          ? 'remote-thumb'
          : hasPalette
            ? 'palette-gradient'
            : 'solid-fallback';

  useEffect(() => {
    if (rawThumbUrl?.trim() && !remoteThumb) {
      log.warn('wallpaper.preview.invalid_url', { themeName, thumbUrl: rawThumbUrl });
    }
    if (!hasImageSource) {
      log.debug('wallpaper.preview.fallback', {
        themeName,
        sourceKind,
        hasCatalogEntry,
        hasBundledImage,
        hasDownloaded,
        hasPalette,
        failedUri,
      });
    }
  }, [
    failedUri,
    hasBundledImage,
    hasCatalogEntry,
    hasDownloaded,
    hasImageSource,
    hasPalette,
    rawThumbUrl,
    remoteThumb,
    sourceKind,
    themeName,
    useBundledImage,
  ]);

  const card = (
    <View
      testID={testID}
      className="overflow-hidden rounded-3xl bg-[#1a1a1a]"
      style={[{ width, height }, selected && { borderWidth: 2, borderColor: foreground }]}>
      {imageSource ? (
        <Image
          source={imageSource}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          onLoad={() => {
            log.info('wallpaper.preview.loaded', { themeName, sourceKind, sourceUri: uriSource });
          }}
          onError={(event) => {
            log.warn('wallpaper.preview.load_failed', {
              themeName,
              sourceKind,
              sourceUri: uriSource,
              error: describeImageLoadError(event),
            });
            if (uriSource) setFailedUri(uriSource);
          }}
        />
      ) : palette ? (
        <LinearGradient
          colors={[
            palette['800'] || WALLPAPER_PLACEHOLDER.d800,
            palette['900'] || WALLPAPER_PLACEHOLDER.d900,
            palette['950'] || WALLPAPER_PLACEHOLDER.d950,
          ]}
          style={StyleSheet.absoluteFillObject}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      ) : (
        <View
          style={[StyleSheet.absoluteFillObject, { backgroundColor: WALLPAPER_PLACEHOLDER.d800 }]}
        />
      )}

      {/* Phone-frame chrome mocks */}
      <VStack align="center" className="absolute left-4 right-4 top-4" spacing={12}>
        <View className="h-[10px] w-[72px] rounded-[5px] bg-white/35" />
        {label ? (
          <View className="items-center gap-0.5">
            <Text size={13} bold style={{ color: INVARIANT_WHITE }}>
              {label}
            </Text>
            {sublabel ? (
              <Text size={10} style={{ color: 'rgba(255,255,255,0.7)' }}>
                {sublabel}
              </Text>
            ) : null}
          </View>
        ) : null}
      </VStack>

      <View className="absolute bottom-4 left-4 right-4 h-14 rounded-xl bg-black/25" />

      {badge ? (
        <View className="absolute right-2.5 top-2.5 rounded-[10px] bg-[#EF4444] px-2 py-[3px]">
          <Text size={10} bold style={{ color: INVARIANT_WHITE }}>
            {badge}
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return card;

  return (
    <PressableFeedback onPress={onPress} animation={false}>
      <PressableFeedback.Scale>{card}</PressableFeedback.Scale>
    </PressableFeedback>
  );
});
