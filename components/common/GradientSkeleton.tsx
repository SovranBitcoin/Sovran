import React, { memo } from 'react';
import { useWindowDimensions } from 'react-native';
import { Skeleton, SkeletonContainer } from 'react-native-skeleton-component';

interface SkeletonProps {
  width?: number;
  height?: number;
  startColor: string;
  endColor: string;
  style?: StyleSheet;
}

/**
 * Memoized Skeleton component to prevent unnecessary re-renders
 */
const MemoizedSkeleton = memo(({ width, height, endColor, startColor, style }: SkeletonProps) => (
  <SkeletonContainer
    backgroundColor={endColor}
    highlightColor={startColor}
    speed={800}
    animation="pulse">
    <Skeleton style={{ width, height, ...style }} />
  </SkeletonContainer>
));

MemoizedSkeleton.displayName = 'MemoizedSkeleton';

/**
 * GradientSkeleton component that provides a responsive skeleton with gradient colors
 */
export const GradientSkeleton: React.FC<SkeletonProps> = ({
  startColor,
  endColor,
  width,
  height,
  style,
}) => {
  const { width: windowWidth } = useWindowDimensions();
  const defaultSize = windowWidth - 32;

  return (
    <MemoizedSkeleton
      width={width ?? defaultSize}
      height={height ?? defaultSize}
      endColor={endColor}
      startColor={startColor}
      style={style}
    />
  );
};
