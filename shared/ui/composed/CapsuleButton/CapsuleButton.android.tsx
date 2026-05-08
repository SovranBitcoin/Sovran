import React from 'react';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { CapsuleButtonFallback, type CapsuleButtonProps } from './CapsuleButton.fallback';

export type { CapsuleButtonProps } from './CapsuleButton.fallback';

const DEFAULT_HEIGHT = 46;

export function CapsuleButton(props: CapsuleButtonProps): React.ReactElement {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const {
    label,
    icon,
    onPress,
    color = foreground,
    height = DEFAULT_HEIGHT,
    testID,
    roundedSide,
  } = props;

  return (
    <CapsuleButtonFallback
      label={label}
      icon={icon}
      onPress={onPress}
      color={color}
      height={height}
      testID={testID}
      roundedSide={roundedSide}
      accentColor={muted}
    />
  );
}
