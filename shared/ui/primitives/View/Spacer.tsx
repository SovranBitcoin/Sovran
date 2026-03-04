/**
 * @fileoverview Spacer Component - Simple vertical spacing utility
 *
 * @module shared/ui/primitives/View/Spacer
 *
 * @description
 * **Simple spacing component for consistent vertical spacing**
 * - Creates vertical space between components
 * - Uses View with fixed height for reliable spacing
 * - Lightweight utility component
 *
 * **Usage:**
 * ```typescript
 * // Basic spacing
 * <Spacer size={16} />
 *
 * // Different spacing values
 * <Spacer size={8} />   // Small spacing
 * <Spacer size={24} />  // Large spacing
 * <Spacer size={32} />  // Extra large spacing
 * ```
 *
 * @see {@link ./View}
 * @see {@link ./VStack}
 * @see {@link ./HStack}
 */

import React from 'react';
import { View } from '@/shared/ui/primitives/View/View';

/**
 * Props for the Spacer component
 *
 * @interface SpacerProps
 */
interface SpacerProps {
  /** Height of the spacer in pixels */
  size: number;
}

/**
 * Simple vertical spacing component
 *
 * @component
 * @param {SpacerProps} props - Component props
 * @returns {JSX.Element}
 *
 * @description
 * **Process:** Create View with specified height → render
 * **Effects:** Adds vertical space between components
 *
 * @example
 * // Basic usage
 * <Spacer size={16} />
 *
 * // In a layout
 * <VStack>
 *   <Text>First item</Text>
 *   <Spacer size={20} />
 *   <Text>Second item</Text>
 * </VStack>
 */
export const Spacer = ({ size }: SpacerProps) => {
  return (
    <View
      style={{
        height: size,
      }}
    />
  );
};
