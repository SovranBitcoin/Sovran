/**
 * The identity block at the top of Mint Info: the mint's icon (with the same
 * bottom-right status dot shown elsewhere in the wallet), its name, and the
 * address when the name is something else. Presentational: everything comes in
 * as props.
 *
 * The dot sits on the icon's bottom-right corner and takes no layout space, so
 * the header never shifts when the audit answers; an unaudited mint shows no dot.
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
import { PresenceDot } from '@/shared/ui/primitives/PresenceDot';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

/** How the mint is running, mapped to the bottom-right presence dot. */
type MintHealth = 'operational' | 'problems' | 'offline';

const HEALTH_TO_PRESENCE: Record<MintHealth, 'online' | 'degraded' | 'offline'> = {
  operational: 'online',
  problems: 'degraded',
  offline: 'offline',
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

/** The status dot fades in when the audit answers; nothing around it moves. */
const STATUS_FADE_MS = 200;
const ICON_SIZE = 72;

type MintHeaderProps = {
  name: string;
  mintUrl?: string;
  iconUrl?: string;
  /** Unset while the mint has no audit: no status dot is shown. */
  health?: MintHealth;
  /** The identity read is still out: the icon shows its placeholder. */
  isLoading?: boolean;
  /** The collapsing-header fade from `useIdentityHeader`. */
  style?: ComponentProps<typeof Animated.View>['style'];
  /**
   * Drives the status dot's fade from outside (0 hidden, 1 shown), so a
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
  const visibleHealth = !isLoading ? health : undefined;
  const ownProgress = useSharedValue(visibleHealth ? 1 : 0);
  useEffect(() => {
    const target = visibleHealth ? 1 : 0;
    ownProgress.set(reducedMotion ? target : withTiming(target, { duration: STATUS_FADE_MS }));
  }, [visibleHealth, reducedMotion, ownProgress]);
  const progress = statusProgress ?? ownProgress;
  const statusStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));

  const host = mintUrl ? urlHostLabel(mintUrl) : '';
  // Kept while loading too: an unseeded name is the address until the info
  // arrives, and a host line appearing then would push everything down.
  const showHost = host.length > 0 && (isLoading || (name !== mintUrl && name !== host));
  const presence = visibleHealth ? HEALTH_TO_PRESENCE[visibleHealth] : null;

  return (
    <Animated.View className="items-center" style={style}>
      <View className="relative">
        <MintIcon
          iconUrl={iconUrl}
          size={ICON_SIZE}
          name={name}
          alt={`${name} icon`}
          isLoading={isLoading}
        />
        {presence ? (
          <Animated.View
            testID="mint-info-health"
            pointerEvents="none"
            className="absolute inset-0"
            style={statusStyle}>
            <PresenceDot presence={presence} size={ICON_SIZE} />
          </Animated.View>
        ) : null}
      </View>
      <Text bold size={22} numberOfLines={2} className="mt-3 text-center">
        {name}
      </Text>
      {showHost ? (
        <Text size={13} color={muted} numberOfLines={1} className="mt-0.5 text-center">
          {host}
        </Text>
      ) : null}
    </Animated.View>
  );
}
