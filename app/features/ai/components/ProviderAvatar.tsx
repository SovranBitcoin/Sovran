import { View } from 'react-native';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { PresenceDot } from '@/shared/ui/primitives/PresenceDot';

import type { ProviderStatus } from '@/shared/lib/routstr/providerHealth';

/**
 * A provider's face in the picker, with a liveness dot on its corner.
 *
 * Routstr nodes publish a name and a description but no icon, so this leans on
 * the app's own seeded `Avatar` — the same generated identity every person
 * without a picture gets — keyed on the provider's URL. Deterministic by
 * construction: the same provider looks the same on every launch and every
 * device, which is what makes a list of near-identical URLs scannable.
 *
 * The dot is the shared `PresenceDot` — the same one the provider list draws
 * on each row's face, so the page the user lands on and the row they tapped
 * make the same mark mean the same thing.
 */

interface ProviderAvatarProps {
  name: string;
  baseUrl: string;
  status?: ProviderStatus;
  size?: number;
}

/** `unknown` is not a state the dot draws — see `PresenceDot`. */
const presenceOf = (status: ProviderStatus) => (status === 'unknown' ? null : status);

export function ProviderAvatar({
  name,
  baseUrl,
  status = 'unknown',
  size = 36,
}: ProviderAvatarProps) {
  return (
    <View className="relative" accessibilityLabel={`${name || baseUrl} provider`}>
      <Avatar
        state="fallback"
        fallbackKind="robot"
        seed={baseUrl}
        size={size}
        alt={name || baseUrl}
      />
      <PresenceDot presence={presenceOf(status)} size={size} />
    </View>
  );
}

/**
 * The same face and the same badge on the AI tab header's pill.
 *
 * It used to be a flat `mdi:robot` glyph — one stock robot, identical for
 * every provider on earth, so the pill and the row the user picked it from did
 * not look like the same thing. The seeded avatar IS this app's placeholder
 * for an identity with no picture of its own, and a provider always has a URL
 * to seed it with, so the pill now shows exactly the face the picker showed.
 *
 * The glyph survives for one case only: no provider chosen yet. There is
 * nothing to seed, and a generated face would invent a counterparty the user
 * has not picked.
 */
export function ProviderPillIcon({
  baseUrl,
  name,
  status = 'unknown',
  size = 32,
}: {
  /** The chosen provider's node URL — the avatar's seed. Absent when the user
   *  has not chosen one. */
  baseUrl?: string;
  name?: string;
  status?: ProviderStatus;
  size?: number;
}) {
  const accent = useThemeColor('accent');

  return (
    <View
      className="relative"
      accessibilityLabel={baseUrl ? `${name || baseUrl} provider` : undefined}>
      {baseUrl ? (
        <Avatar
          state="fallback"
          fallbackKind="robot"
          seed={baseUrl}
          size={size}
          alt={name || baseUrl}
        />
      ) : (
        <Icon name="mdi:robot" size={size} color={accent} />
      )}
      <PresenceDot presence={presenceOf(status)} size={size} />
    </View>
  );
}
