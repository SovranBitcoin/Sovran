import type { ReactNode } from 'react';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';
import { View } from '@/shared/ui/primitives/View/View';

const BITE = 6;
const PITCH = 10;

interface EcashNoteProps {
  /** The colour behind the note: its serrated edges are bites of this. */
  backdrop: string;
  height?: number;
  /** A note that has been picked is drawn solid. */
  selected?: boolean;
  /** A note that cannot be picked (none of it left) is drawn faint. */
  faint?: boolean;
  children: ReactNode;
}

/**
 * One piece of ecash the wallet holds, drawn as a banknote: a flat slip whose
 * short edges are serrated like a torn-off note. Wherever an amount appears on
 * one of these it is an amount that exists as proofs, so it can be handed over
 * with no mint and no network.
 */
export function EcashNote({
  backdrop,
  height = 36,
  selected = false,
  faint = false,
  children,
}: EcashNoteProps) {
  const foreground = useThemeColor('foreground');
  const bites = Math.max(2, Math.floor(height / PITCH));
  const inset = (height - bites * PITCH) / 2 + (PITCH - BITE) / 2;
  const paper = {
    height,
    backgroundColor: selected ? foreground : withAlpha(foreground, faint ? 0.05 : 0.12),
  };
  const bite = { width: BITE, height: BITE, borderRadius: BITE / 2, backgroundColor: backdrop };
  const edge = (side: 'left' | 'right') =>
    Array.from({ length: bites }, (_, index) => (
      <View
        key={`${side}-${index}`}
        pointerEvents="none"
        className="absolute"
        style={[bite, { [side]: -BITE / 2, top: inset + index * PITCH }]}
      />
    ));

  return (
    <View className="items-center justify-center rounded-[3px] px-4" style={paper}>
      {children}
      {edge('left')}
      {edge('right')}
    </View>
  );
}
