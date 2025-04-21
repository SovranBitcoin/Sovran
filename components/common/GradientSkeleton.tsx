import { memo } from 'react';
import { useWindowDimensions } from 'react-native';
import { Skeleton, SkeletonContainer } from 'react-native-skeleton-component';

// Memoize the Skeleton component to prevent unnecessary re-renders
const MemoizedSkeleton = memo(({ width, height, endColor, startColor, style, ...props }) => (
  <SkeletonContainer
    backgroundColor={endColor}
    highlightColor={startColor}
    speed={800}
    animation="pulse">
    <Skeleton style={{ width, height, ...style, ...props }} />
  </SkeletonContainer>
));

// Use useWindowDimensions to get responsive dimensions
export const GradientSkeleton = ({ startColor, endColor, width, height, style, ...props }) => {
  const { width: w } = useWindowDimensions();
  const size = w - 32;

  return (
    <MemoizedSkeleton
      width={width || size}
      height={height || size}
      endColor={endColor}
      startColor={startColor}
      style={{
        ...style,
        ...props,
      }}
    />
  );
};
