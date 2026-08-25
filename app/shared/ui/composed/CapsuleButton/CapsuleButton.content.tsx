import React from 'react';
import { StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import Icon from 'assets/icons';
import { controlHeight } from '@/shared/styles/tokens';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import type { CapsuleButtonProps } from './CapsuleButton.types';

// controlHeight.cta (48) — every tier agrees on the same default height.
export const DEFAULT_HEIGHT = controlHeight.cta;

/** `fitContent` sizes to the label; otherwise stretch to the full parent width. */
export function capsuleWidthStyle(fitContent: boolean | undefined): StyleProp<ViewStyle> {
  return fitContent ? null : styles.fullWidth;
}

type CapsuleButtonContentProps = Pick<
  CapsuleButtonProps,
  | 'label'
  | 'icon'
  | 'iconNode'
  | 'iconSize'
  | 'textSize'
  | 'labelNumberOfLines'
  | 'contentStyle'
  | 'textStyle'
> & {
  contentColor: string;
  height: number;
  widthStyle: StyleProp<ViewStyle>;
};

/** The icon + label row; rendered identically by every tier. */
export function CapsuleButtonContent({
  label,
  icon,
  iconNode,
  iconSize = 16,
  textSize = 14,
  labelNumberOfLines,
  contentStyle,
  textStyle,
  contentColor,
  height,
  widthStyle,
}: CapsuleButtonContentProps): React.ReactElement {
  return (
    <HStack
      align="center"
      justify="center"
      gap={8}
      style={[styles.content, widthStyle, { minHeight: height }, contentStyle]}>
      {iconNode ?? (icon ? <Icon name={icon} size={iconSize} color={contentColor} /> : null)}
      <Text
        size={textSize}
        bold
        numberOfLines={labelNumberOfLines}
        style={[{ color: contentColor }, textStyle]}>
        {label}
      </Text>
    </HStack>
  );
}

const styles = StyleSheet.create({
  fullWidth: {
    width: '100%',
  },
  content: {
    paddingHorizontal: 12,
  },
});
