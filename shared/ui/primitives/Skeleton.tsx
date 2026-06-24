import React, { useRef } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import {
  useVisualLayoutLogger,
  visualLayoutScopePart,
  type VisualLayoutConfig,
} from '@/shared/lib/contentShiftLog';
import { cn } from '@/shared/lib/utils';

type SkeletonVisualProps = {
  visualScope?: string;
  visualKey?: string;
  visualSurface?: string;
  visualComponent?: string;
  visualPhase?: string;
  visualExtra?: VisualLayoutConfig['extra'];
  visualDisabled?: boolean;
};

type SkeletonProps = React.ComponentPropsWithoutRef<typeof View> & SkeletonVisualProps;

let skeletonVisualInstance = 0;

const Skeleton = React.forwardRef<View, SkeletonProps>(function Skeleton(
  {
    className,
    onLayout,
    visualScope = 'loading.skeleton',
    visualKey,
    visualSurface = 'shared',
    visualComponent = 'Skeleton',
    visualPhase = 'loading',
    visualExtra,
    visualDisabled,
    ...props
  },
  forwardedRef
) {
  const instanceKeyRef = useRef<string | null>(null);
  if (instanceKeyRef.current === null) {
    skeletonVisualInstance += 1;
    instanceKeyRef.current = `skeleton:${skeletonVisualInstance}`;
  }
  const layout = useVisualLayoutLogger({
    enabled: visualDisabled !== true,
    scope: visualScope,
    surface: visualSurface,
    component: visualComponent,
    itemKey: visualKey ? visualLayoutScopePart(visualKey) : instanceKeyRef.current,
    itemType: 'skeleton',
    phase: visualPhase,
    extra: visualExtra,
  });

  const setRef = (node: View | null) => {
    layout.ref(node);
    if (typeof forwardedRef === 'function') {
      forwardedRef(node);
    } else if (forwardedRef) {
      forwardedRef.current = node;
    }
  };
  const handleLayout = (event: LayoutChangeEvent) => {
    onLayout?.(event);
    layout.onLayout(event);
  };

  return (
    <View
      {...props}
      ref={setRef}
      collapsable={false}
      className={cn('bg-skeleton animate-pulse rounded-md', className)}
      onLayout={handleLayout}
    />
  );
});

export { Skeleton };
