import React from 'react';

import { Log } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { CapsuleButtonFallback, type CapsuleButtonProps } from './CapsuleButton.fallback';
import { CapsuleButtonLiquid } from './CapsuleButton.liquid';

export type { CapsuleButtonProps } from './CapsuleButton.fallback';

const DEFAULT_HEIGHT = 46;

export function CapsuleButton(props: CapsuleButtonProps): React.ReactElement {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const { color = foreground, height = DEFAULT_HEIGHT } = props;

  if (supportsLiquidGlass()) {
    return (
      <Log name="CapsuleButton">
        <CapsuleButtonLiquid {...props} color={color} />
      </Log>
    );
  }

  return <CapsuleButtonFallback {...props} accentColor={muted} color={color} height={height} />;
}
