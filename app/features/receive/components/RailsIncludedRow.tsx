import { withUniwind } from 'uniwind';

import type { Bip321Rail } from '@/features/receive/lib/bip321RailSelection';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { paramPopup } from '@/shared/lib/popup';
import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { View } from '@/shared/ui/primitives/View/View';

const RailCapsule = withUniwind(CapsuleButton);

const RAIL_CLASSES = {
  included: 'bg-accent/15 border-accent',
  unavailable: 'bg-surface-secondary border-transparent',
  off: 'bg-transparent border-muted',
} as const;

export function RailsIncludedRow({ rails }: { rails: Bip321Rail[] }) {
  const [accent, muted, foreground] = useThemeColor(['accent', 'muted', 'foreground'] as const);

  return (
    <View className="mx-4 my-3 flex-row flex-wrap justify-center gap-2">
      {rails.map((rail) => (
        <RailCapsule
          key={rail.id}
          testID={`receive-unified-rail-${rail.id}`}
          label={rail.label}
          accessibilityLabel={`${rail.label}, ${rail.state}`}
          fitContent
          isActive={rail.state === 'included'}
          color={rail.state === 'included' ? accent : rail.state === 'off' ? foreground : muted}
          className={RAIL_CLASSES[rail.state]}
          onPress={() =>
            paramPopup('unified-rail-info', {
              title: rail.label,
              message:
                rail.state === 'unavailable'
                  ? (rail.reason ?? `${rail.label} is unavailable`)
                  : rail.state === 'off'
                    ? 'Turn on this method in Advanced to include it.'
                    : 'Included in this Unified request.',
            })
          }
        />
      ))}
    </View>
  );
}
