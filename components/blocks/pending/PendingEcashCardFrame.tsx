import React from 'react';
import { GradientCardFrame } from 'components/ui/GradientCardFrame';

const LEFT_ICON = {
  name: 'mdi:clock-outline',
  size: 90,
  style: { top: -18, left: -18, transform: [{ rotate: '-12deg' as const }] },
} as const;

const RIGHT_ICON = {
  name: 'mdi:cash-multiple',
  size: 140,
  style: { bottom: -34, right: -34, transform: [{ rotate: '14deg' as const }] },
} as const;

export function PendingEcashCardFrame({
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
    <GradientCardFrame
      accentColor={accentColor}
      backgroundColor={backgroundColor}
      highlightColor={highlightColor}
      leftIcon={LEFT_ICON}
      rightIcon={RIGHT_ICON}>
      {children}
    </GradientCardFrame>
  );
}
