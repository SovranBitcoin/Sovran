import { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { zIndex } from '@/shared/styles/tokens';
import { LoadingIndicator } from '@/shared/blocks/status';
import { useWhitenoiseSetup } from '../hooks/useWhitenoiseSetup';
import { useWhitenoise } from '../WhitenoiseContext';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import Icon from 'assets/icons';

/**
 * Floating call-to-action card that nudges the user to publish key
 * packages so they can receive White Noise / Marmot DMs. Modeled on
 * Signal's "Verify your Signal PIN" reminder: a rounded card with a
 * left icon + title/description, a separator, and a primary action
 * across the bottom.
 *
 * The action runs in-place — no nav. Three phases:
 *   1. `idle`     → "Set up" label
 *   2. `running`  → spinner replaces label while bootstrap publishes
 *                   key packages
 *   3. `success`  → green check scales in with overshoot, hold ~900ms,
 *                   then the whole card fades out and unmounts
 *
 * Mounted at the tabs layout level (`app/(drawer)/(tabs)/_layout.tsx`)
 * with `position: absolute`, anchored above the native tab bar via the
 * safe-area bottom inset + estimated tab-bar height. Only renders on
 * the Contacts tab.
 */
const TAB_BAR_HEIGHT_ESTIMATE = Platform.select({ ios: 49, android: 56, default: 56 });
const FLOAT_GAP = 12;
// LoadingIndicator's `done` choreography runs ~T_FILL+T_ICON+D_ICON_IN
// (~1.4s end-to-end). Start the dismiss right as the glyph finishes —
// staring at a fully-drawn check for an extra 300ms felt slow, and
// overlapping the tail-end of the draw with the slide reads as one
// continuous beat instead of two pauses.
const SUCCESS_HOLD_MS = 1400;

type Phase = 'idle' | 'running' | 'success' | 'gone';

// The card fades in on mount and fades out on dismiss — no slide. A plain
// opacity cross-fade reads calmer than the previous slide-down and matches
// how the rest of the app's transient surfaces appear/disappear.
const cardEnter = FadeIn.duration(250);
const cardExit = FadeOut.duration(400);

export function WhitenoiseSetupBanner({ testID }: { testID?: string }) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { isReady, isLoading, isBootstrapping, bootstrap } = useWhitenoiseSetup();
  const { client } = useWhitenoise();
  const whitenoiseEnabled = useSettingsStore((state) => state.whitenoiseEnabled);

  const [phase, setPhase] = useState<Phase>('idle');

  // Reset phase if upstream `isReady` flips back to false (e.g. user
  // wiped key packages on another surface). Keeps the banner reusable.
  useEffect(() => {
    if (phase === 'gone' && !isReady) setPhase('idle');
  }, [isReady, phase]);

  // Hold the green check for a beat, then dismiss. Owned by an effect so
  // unmount (profile switch, tab change) clears the timer instead of
  // firing setPhase on a dead component.
  useEffect(() => {
    if (phase !== 'success') return;
    const id = setTimeout(() => setPhase('gone'), SUCCESS_HOLD_MS);
    return () => clearTimeout(id);
  }, [phase]);

  const onPress = useCallback(async () => {
    if (phase !== 'idle') return;
    setPhase('running');
    await bootstrap();
    setPhase('success');
  }, [phase, bootstrap]);

  // Render gates — idle state hides when there's nothing to set up.
  // Once the user starts, we keep rendering through the full sequence
  // even if upstream `isReady` flips during the animation.
  const shouldRenderCard = (() => {
    if (!whitenoiseEnabled) return false;
    if (phase === 'gone') return false;
    if (phase !== 'idle') return true;
    if (!pathname.includes('/contacts')) return false;
    if (!client) return false;
    if (isLoading) return false;
    if (isReady) return false;
    return true;
  })();

  const bottomOffset = insets.bottom + (TAB_BAR_HEIGHT_ESTIMATE ?? 49) + FLOAT_GAP;

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: bottomOffset }]}>
      {shouldRenderCard ? (
        <Animated.View entering={cardEnter} exiting={cardExit} style={styles.cardWrap}>
          <BannerCard
            phase={phase}
            onPress={onPress}
            isBootstrapping={isBootstrapping}
            testID={testID}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

function BannerCard({
  phase,
  onPress,
  isBootstrapping,
  testID,
}: {
  phase: Phase;
  onPress: () => void;
  isBootstrapping: boolean;
  testID?: string;
}) {
  const [surface, foreground, foregroundSecondary, accent, iconBg, separator] = useThemeColor([
    'surface-secondary',
    'foreground',
    'surface-secondary-foreground',
    'accent',
    // One shade darker than the card (`surface-secondary`) but not as
    // deep as `background`. In heroui's token scale this is the base
    // surface — gives the marmot glyph a subtle inset without going
    // pitch-black on dark mode.
    'surface',
    'separator-secondary',
  ] as const);

  const isInteractive = phase === 'idle';
  // Same LoadingIndicator the restore screen and the payment toast use,
  // so the affordance reads identically across the app.
  const indicatorPhase: 'loading' | 'done' | null =
    phase === 'running' || isBootstrapping ? 'loading' : phase === 'success' ? 'done' : null;

  return (
    <Pressable
      testID={testID ?? 'whitenoise-setup-banner'}
      onPress={onPress}
      disabled={!isInteractive}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: surface,
          opacity: pressed && isInteractive ? 0.95 : 1,
        },
      ]}>
      <View style={styles.body}>
        <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
          <Icon name="internal:whitenoise" size={32} />
        </View>
        <View style={styles.copy}>
          <Text size={16} bold style={{ color: foreground }} numberOfLines={1}>
            Set up White Noise
          </Text>
          <Text
            size={13}
            style={{ color: foregroundSecondary, lineHeight: 18, marginTop: 2 }}
            numberOfLines={3}>
            Publish your encryption keys so contacts can start MLS-encrypted DMs and group chats
            with you.
          </Text>
        </View>
      </View>
      <View style={[styles.divider, { backgroundColor: separator }]} />
      <View style={styles.actionRow}>
        {indicatorPhase ? (
          <LoadingIndicator size={26} phase={indicatorPhase} result="success" />
        ) : (
          <Text size={15} bold style={{ color: accent }}>
            Set up
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: zIndex.sticky,
    elevation: 10,
  },
  cardWrap: {
    // Dedicated wrapper so the Reanimated `exiting` keyframe operates
    // on a stable layout box. Pressable is inside it.
  },
  card: {
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
  actionRow: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
