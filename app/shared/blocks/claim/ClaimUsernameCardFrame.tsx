import React from 'react';
import { GradientCardFrame } from '@/shared/ui/composed/GradientCardFrame';
import { Log } from '@/shared/lib/logger';

const LEFT_ICON = {
  name: 'mingcute:lightning-fill',
  size: 80,
  style: { top: -20, left: -20, transform: [{ rotate: '-15deg' as const }] },
} as const;

const RIGHT_ICON = {
  name: 'mingcute:lightning-fill',
  size: 120,
  style: { bottom: -30, right: -30, transform: [{ rotate: '15deg' as const }] },
} as const;

export function ClaimUsernameCardFrame({
  accentColor,
  backgroundColor,
  highlightColor,
  children,
}: {
  accentColor: string;
  backgroundColor: string;
  highlightColor: string;
  children?: React.ReactNode;
}) {
  return (
    <Log name="ClaimUsernameCardFrame">
      <GradientCardFrame
        accentColor={accentColor}
        backgroundColor={backgroundColor}
        highlightColor={highlightColor}
        leftIcon={LEFT_ICON}
        rightIcon={RIGHT_ICON}>
        {children}
      </GradientCardFrame>
    </Log>
  );
}
