import React from 'react';
import { BlurCardFrame } from 'components/ui/BlurCardFrame';

export function ProfilesCardFrame({
  accentColor,
  children,
}: {
  accentColor: string;
  highlightColor?: string;
  children?: React.ReactNode;
}) {
  return <BlurCardFrame accentColor={accentColor}>{children}</BlurCardFrame>;
}
