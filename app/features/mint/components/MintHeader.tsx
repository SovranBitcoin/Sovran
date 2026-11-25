/**
 * The identity block at the top of Mint Info: the mint's icon, its name, the
 * address when the name is something else, and one line saying how the mint
 * is running. Presentational: everything comes in as props.
 *
 * The status line always takes its height, so the page never moves when the
 * audit answers; an unaudited mint keeps an invisible placeholder there.
 */
import { useEffect, type ComponentProps } from 'react';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { urlHostLabel } from '@/shared/lib/url';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

/** How the mint is running, in the words the status line uses. */
type MintHealth = 'operational' | 'problems' | 'offline';

const MINT_HEALTH: Record<MintHealth, { label: string; dot: string }> = {
  operational: { label: 'Operational', dot: 'bg-success' },
  problems: { label: 'Having problems', dot: 'bg-warning' },
  offline: { label: 'Offline', dot: 'bg-danger' },
};

/** The auditor's state (`OK` / `ERROR` / `OFFLINE`), or nothing for an unaudited mint. */
export function mintHealthFromAudit(state: string | undefined): MintHealth | undefined {
  switch (state?.toUpperCase()) {
    case 'OK':
      return 'operational';
    case 'ERROR':
      return 'problems';
    case 'OFFLINE':
      return 'offline';
    default:
      return undefined;
  }
}

/** The status line fades in when the audit answers; nothing around it moves. */
const STATUS_FADE_MS = 200;
const ICON_SIZE = 72;

type MintHeaderProps = {
  name: string;
  mintUrl?: string;
  iconUrl?: string;
  /** Unset while the mint has no audit: the line keeps its place, invisible. */
  health?: MintHealth;
  /** The identity read is still out: the icon shows its placeholder. */
  isLoading?: boolean;
  /** The collapsing-header fade from `useIdentityHeader`. */
  style?: ComponentProps<typeof Animated.View>['style'];
  /**
   * Drives the status line's fade from outside (0 hidden, 1 shown), so a
   * design-system scrubber can hold any frame. Omitted, it follows `health`.
   */
  statusProgress?: SharedValue<number>;
};

export function MintHeader({
  name,
  mintUrl,
  iconUrl,
  health,
  isLoading = false,
  style,
  statusProgress,
}: MintHeaderProps) {
  const muted = useThemeColor('muted');
  const reducedMotion = useReducedMotion();
  const ownProgress = useSharedValue(health ? 1 : 0);
  useEffect(() => {
    const target = health ? 1 : 0;
    ownProgress.set(reducedMotion ? target : withTiming(target, { duration: STATUS_FADE_MS }));
  }, [health, reducedMotion, ownProgress]);
  const progress = statusProgress ?? ownProgress;
  const statusStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));

  const host = mintUrl ? urlHostLabel(mintUrl) : '';
  const showHost = host.length > 0 && name !== mintUrl && name !== host;
  // The placeholder holds the longest words, so the line never changes width.
  const shown = health ? MINT_HEALTH[health] : MINT_HEALTH.problems;

  return (
    <Animated.View className="items-center" style={style}>
      <MintIcon
        iconUrl={iconUrl}
        size={ICON_SIZE}
        name={name}
        alt={`${name} icon`}
        isLoading={isLoading}
      />
      <Text bold size={22} numberOfLines={2} className="mt-3 text-center">
        {name}
      </Text>
      {showHost ? (
        <Text size={13} color={muted} numberOfLines={1} className="mt-0.5 text-center">
          {host}
        </Text>
      ) : null}
      <Animated.View
        testID="mint-info-health"
        className="mt-1 h-[22px] flex-row items-center justify-center gap-1.5"
        style={statusStyle}
        accessible={health !== undefined}
        accessibilityLabel={health ? `Status: ${shown.label}` : undefined}
        accessibilityElementsHidden={health === undefined}
        importantForAccessibility={health ? 'auto' : 'no-hide-descendants'}>
        <View className={`h-2 w-2 rounded-full ${shown.dot}`} />
        <Text size={13} color={muted} numberOfLines={1} accessible={false}>
          {shown.label}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}
