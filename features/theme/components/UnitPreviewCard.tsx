/**
 * UnitPreviewCard — phone-frame mock of the wallet screen backgrounded by a
 * specific wallpaper theme. Shared between the Theme Preview carousel (one
 * card per unit) and the Gallery album cards (one card per album cover).
 */

import React from 'react';
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

  const imageSource = bundledImage
    ? bundledImage
    : downloaded
      ? { uri: downloaded.localUri }
      : catalogEntry?.thumbUrl
        ? { uri: catalogEntry.thumbUrl }
        : null;

  const card = (
    <View
      testID={testID}
      className="overflow-hidden rounded-3xl bg-[#1a1a1a]"
      style={[{ width, height }, selected && { borderWidth: 2, borderColor: foreground }]}>
      {imageSource ? (
        <Image source={imageSource} style={StyleSheet.absoluteFillObject} contentFit="cover" />
      ) : palette ? (
        <LinearGradient
          colors={[
            palette['800'] || '#1a1a1a',
            palette['900'] || '#0d0d0d',
            palette['950'] || '#000000',
          ]}
          style={StyleSheet.absoluteFillObject}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#1a1a1a' }]} />
      )}

      {/* Phone-frame chrome mocks */}
      <VStack align="center" className="absolute left-4 right-4 top-4" spacing={12}>
        <View className="h-[10px] w-[72px] rounded-[5px] bg-white/35" />
        {label ? (
          <View className="items-center gap-0.5">
            <Text size={13} bold style={{ color: '#fff' }}>
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
          <Text size={10} bold style={{ color: '#fff' }}>
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
