import React, { useCallback, useRef } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import {
  useVisualLayoutLogger,
  visualLayoutScopePart,
  type VisualLayoutConfig,
} from '@/shared/lib/contentShiftLog';
import { IS_ANDROID_E2E } from '@/shared/lib/e2e/isAndroidE2E';
import { cn } from '@/shared/lib/classNames';

// NativeWind's `animate-pulse` is a Reanimated opacity loop that never stops
// while the skeleton is mounted. On an offline screen a skeleton can be mounted
// indefinitely (e.g. mint info that will never load), and that perpetual
// animation stops the Android window from ever reaching idle — so
// `uiautomator dump` returns an empty tree and every AX assert on the screen is
// blind. Under Android e2e render a static placeholder instead; production/iOS
// keep the pulse.
const E2E_STATIC_SKELETON = IS_ANDROID_E2E;

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

  const setRef = useCallback(
    (node: View | null) => {
      layout.ref(node);
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    },
    [forwardedRef, layout]
  );
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onLayout?.(event);
      layout.onLayout(event);
    },
    [layout, onLayout]
  );

  return (
    <View
      {...props}
      ref={setRef}
      collapsable={false}
      className={cn('bg-skeleton rounded-md', !E2E_STATIC_SKELETON && 'animate-pulse', className)}
      onLayout={handleLayout}
    />
  );
});

export { Skeleton };
