/**
 * The tinted circle a mint-change entry wears to say what kind of event it is:
 * the change's own glyph (a bolt for a Lightning rail, a key for a rotation),
 * tinted by whether the mint gained or lost something.
 */
import { StyleSheet } from 'react-native';
import { withAlpha } from '@/shared/lib/color';

import Icon from '@/assets/icons';
import type { MintChangeTone } from '@/features/mint/lib/mintChanges/phrase';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { alpha } from '@/shared/styles/tokens';
import { View } from '@/shared/ui/primitives/View/View';

const REASON_GLYPH_SIZE = 28;

/** Tone → theme colour. Kept here so the phrasing library stays UI-free. */
function useMintChangeToneColor(tone: MintChangeTone): string {
  const [success, danger, accent, warning, muted] = useThemeColor([
    'success',
    'danger',
    'accent',
    'warning',
    'muted',
  ] as const);
  if (tone === 'success') return success;
  if (tone === 'danger') return danger;
  if (tone === 'accent') return accent;
  if (tone === 'warning') return warning;
  return muted;
}

/** The tinted circle a notification row wears to say what kind of event it is. */
export function MintChangeGlyph({
  icon,
  tone,
  size = REASON_GLYPH_SIZE,
}: {
  icon: string;
  tone: MintChangeTone;
  size?: number;
}) {
  const color = useMintChangeToneColor(tone);
  return (
    <View
      style={[
        styles.reasonIcon,
        {
          backgroundColor: withAlpha(color, alpha.faint),
          borderRadius: size / 2,
          height: size,
          width: size,
        },
      ]}>
      <Icon name={icon} size={Math.round(size * 0.6)} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  reasonIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 7,
  },
});
