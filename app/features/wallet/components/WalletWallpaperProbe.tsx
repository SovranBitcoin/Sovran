import type { ReactElement } from 'react';

import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { useThemeStore } from '@/shared/stores/profile/themeStore';
import { useUnitWallpaper } from '@/shared/lib/theme/useUnitWallpaper';
import { useWallpaperRenderStore } from '@/shared/lib/theme/wallpaperRenderState';
import { useMintStore } from '@/shared/stores/profile/mintStore';

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
export function WalletWallpaperProbe(): ReactElement {
  const activeAlbumSlug = useThemeStore((state) => state.activeAlbumSlug);
  const slug = activeAlbumSlug ?? 'none';

  const activeUnitId = useMintStore((state) => state.activeUnit);
  const resolvedTheme = useUnitWallpaper(activeUnitId);
  const renderStatus = useWallpaperRenderStore((state) => state.statusByTheme[resolvedTheme]);
  const imageStatus = renderStatus ?? 'none';

  return (
    <>
      <E2EAccessibilityProbe
        testID={`wallet-wallpaper:${slug}`}
        accessibilityLabel={`Active wallpaper album ${slug}`}
        value={slug}
      />
      <E2EAccessibilityProbe
        testID={`wallet-wallpaper-image:${imageStatus}`}
        accessibilityLabel={`Wallpaper image ${imageStatus} for ${resolvedTheme}`}
        value={imageStatus}
      />
    </>
  );
}
