import React from 'react';
import { StyleSheet } from 'react-native';

import { useThemeStore } from '@/shared/stores/profile/themeStore';
import { useUnitWallpaper } from '@/shared/lib/theme/useUnitWallpaper';
import { useWallpaperRenderStore } from '@/shared/lib/theme/wallpaperRenderState';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { View } from '@/shared/ui/primitives/View/View';

/**
 * Accessibility-only evidence of the applied wallpaper.
 *
 * Two probes, because "an album is selected" and "the wallpaper is on screen"
 * are different facts and a bug lived in the gap between them:
 *
 *  - `wallet-wallpaper:<album-slug>` — the persisted album selection
 *    (`themeStore.activeAlbumSlug`). Flips from `none` on Apply.
 *  - `wallet-wallpaper-image:<status>` — whether the ACTIVE unit's resolved
 *    wallpaper image actually decoded and painted (`loaded`), failed
 *    (`failed`), or hasn't resolved to an image yet (`none`). This is the only
 *    signal a truncated/empty download can't fake — it comes straight from
 *    SpriteView's `<Image>` onLoad/onError.
 */
export function WalletWallpaperProbe(): React.ReactElement {
  const activeAlbumSlug = useThemeStore((state) => state.activeAlbumSlug);
  const slug = activeAlbumSlug ?? 'none';

  const activeUnitId = useMintStore((state) => state.activeUnit);
  const resolvedTheme = useUnitWallpaper(activeUnitId);
  const renderStatus = useWallpaperRenderStore((state) => state.statusByTheme[resolvedTheme]);
  const imageStatus = renderStatus ?? 'none';

  const slugValue = React.useMemo(() => ({ text: slug }), [slug]);
  const imageValue = React.useMemo(() => ({ text: imageStatus }), [imageStatus]);
  return (
    <>
      <View
        testID={`wallet-wallpaper:${slug}`}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`Active wallpaper album ${slug}`}
        accessibilityValue={slugValue}
        importantForAccessibility="yes"
        collapsable={false}
        pointerEvents="none"
        style={styles.probe}
      />
      <View
        testID={`wallet-wallpaper-image:${imageStatus}`}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`Wallpaper image ${imageStatus} for ${resolvedTheme}`}
        accessibilityValue={imageValue}
        importantForAccessibility="yes"
        collapsable={false}
        pointerEvents="none"
        style={styles.probe}
      />
    </>
  );
}

const styles = StyleSheet.create({
  probe: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
  },
});
