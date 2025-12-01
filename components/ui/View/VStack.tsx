/**
 * @fileoverview VStack Component - Vertical stack layout with automatic spacing
 *
 * @module components/ui/View/VStack
 *
 * @description
 * **Vertical stack layout component with intelligent spacing**
 * - Automatically adds spacing between child components
 * - Supports both spacing and gap properties
 * - Handles blur effects and background class stripping
 * - Configurable alignment, justification, and flex properties
 *
 * **Features:**
 * - Automatic spacing between children
 * - Support for both spacing and gap properties
 * - Flex layout configuration
 * - Blur effect support
 * - Background class handling
 *
 * **Usage:**
 * ```typescript
 * // Basic vertical stack
 * <VStack spacing={16}>
 *   <Text>Item 1</Text>
 *   <Text>Item 2</Text>
 *   <Text>Item 3</Text>
 * </VStack>
 *
 * // With gap instead of spacing
 * <VStack gap={20}>
 *   <Text>Item 1</Text>
 *   <Text>Item 2</Text>
 * </VStack>
 *
 * // With alignment and blur
 * <VStack align="center" blur blurIntensity={50}>
 *   <Text>Centered content</Text>
 * </VStack>
 * ```
 *
 * @see {@link ./View}
 * @see {@link ./HStack}
 * @see {@link ./Spacer}
 */

import React from 'react';
import { FlexStyle, DimensionValue, StyleSheet } from 'react-native';
import { View, ViewProps } from './View';
import { supportsBlur } from 'helper/version';

/**
 * Props for the VStack component
 *
 * @interface VStackProps
 * @extends ViewProps
 */
export type VStackProps = ViewProps & {
  /** Spacing between child components (deprecated, use gap) */
  spacing?: number;
  /** Gap between child components (preferred over spacing) */
  gap?: number;
  /** Vertical alignment of children */
  align?: FlexStyle['alignItems'];
  /** Horizontal justification of children */
  justify?: FlexStyle['justifyContent'];
  /** Flex value for the container */
  flex?: number;
  /** Flex wrap behavior */
  wrap?: FlexStyle['flexWrap'];
  /** Flex grow value */
  flexGrow?: number;
  /** Flex shrink value */
  flexShrink?: number;
  /** Flex basis value */
  flexBasis?: DimensionValue;
  /** Flex direction (always 'column' for VStack) */
  flexDirection?: FlexStyle['flexDirection'];
};

/**
 * Vertical stack layout component with automatic spacing
 *
 * @component
 * @param {VStackProps} props - Component props
 * @returns {JSX.Element}
 *
 * @description
 * **Process:** Process spacing → create flex styles → map children with spacing → render
 * **Effects:** Creates vertical layout with consistent spacing between children
 *
 * @example
 * // Basic vertical stack
 * <VStack spacing={16}>
 *   <Text>First item</Text>
 *   <Text>Second item</Text>
 *   <Text>Third item</Text>
 * </VStack>
 *
 * // With gap and alignment
 * <VStack gap={20} align="center" justify="space-between">
 *   <Text>Top item</Text>
 *   <Text>Bottom item</Text>
 * </VStack>
 *
 * // With blur effect
 * <VStack blur blurIntensity={70} className="p-4">
 *   <Text>Blurred stack content</Text>
 * </VStack>
 */
const VStack = React.forwardRef<any, VStackProps>((props, ref) => {
  const {
    spacing = 0,
    gap,
    align = 'stretch',
    justify = 'flex-start',
    flex,
    flexGrow,
    flexShrink,
    flexBasis,
    wrap = 'nowrap',
    style,
    children,
    className,
    blur,
    ...rest
  } = props;

  // Use gap if provided, otherwise fall back to spacing
  const effectiveSpacing = gap !== undefined ? gap : spacing;

  const stackStyle = StyleSheet.flatten([
    {
      flexDirection: 'column' as const,
      alignItems: align,
      justifyContent: justify,
      flex: flex,
      flexGrow: flexGrow,
      flexShrink: flexShrink,
      flexBasis: flexBasis,
      flexWrap: wrap,
    },
    style,
  ]);

  const processedChildren = React.Children.map(children, (child, index) => {
    if (!React.isValidElement(child)) return child;

    // Add spacing except for the last child
    const isLastChild = index === React.Children.count(children) - 1;
    if (effectiveSpacing > 0 && !isLastChild) {
      return (
        <React.Fragment key={index}>
          {child}
          <View style={{ height: effectiveSpacing }} />
        </React.Fragment>
      );
    }

    return child;
  });

  // Only enable blur if the device supports it
  const effectiveBlur = blur && supportsBlur();

  // Strip background classes when blur is enabled and supported
  const cleanClassName = effectiveBlur ? className?.replace(/bg-\S+/g, '').trim() : className;

  return (
    <View ref={ref} style={stackStyle} className={cleanClassName} blur={effectiveBlur} {...rest}>
      {processedChildren}
    </View>
  );
});

VStack.displayName = 'VStack';

export { VStack };
