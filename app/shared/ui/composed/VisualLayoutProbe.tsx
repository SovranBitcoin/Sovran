import { useCallback, useMemo, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useVisualLayoutLogger, type VisualLayoutConfig } from '@/shared/lib/contentShiftLog';

type VisualLayoutProbeProps = VisualLayoutConfig & {
  children: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  pointerEvents?: 'box-none' | 'none' | 'box-only' | 'auto';
  onLayout?: (event: LayoutChangeEvent) => void;
};

type VisualLayoutProbeExtra = Exclude<VisualLayoutConfig['extra'], undefined>;

function primitiveStyleValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

function styleStackSnapshot(
  style: StyleProp<ViewStyle> | undefined,
  pointerEvents: VisualLayoutProbeProps['pointerEvents']
): Record<string, unknown> {
  const flattened = StyleSheet.flatten(style);
  return {
    pointerEvents: pointerEvents ?? null,
    stylePosition: primitiveStyleValue(flattened?.position),
    styleZIndex: primitiveStyleValue(flattened?.zIndex),
    styleElevation: primitiveStyleValue(flattened?.elevation),
    styleOverflow: primitiveStyleValue(flattened?.overflow),
    styleDisplay: primitiveStyleValue(flattened?.display),
    styleOpacity: primitiveStyleValue(flattened?.opacity),
    styleTop: primitiveStyleValue(flattened?.top),
    styleRight: primitiveStyleValue(flattened?.right),
    styleBottom: primitiveStyleValue(flattened?.bottom),
    styleLeft: primitiveStyleValue(flattened?.left),
  };
}

export function VisualLayoutProbe({
  children,
  className,
  style,
  pointerEvents,
  onLayout,
  extra,
  ...config
}: VisualLayoutProbeProps) {
  const visualExtra = useMemo<VisualLayoutProbeExtra>(
    () => () => ({
      ...styleStackSnapshot(style, pointerEvents),
      ...(typeof extra === 'function' ? extra() : (extra ?? {})),
    }),
    [extra, pointerEvents, style]
  );
  const layout = useVisualLayoutLogger({ ...config, extra: visualExtra });
  // Destructured to a `*Ref` binding: the compiler can't tell that a `.ref`
  // property read in JSX is a ref OBJECT and skips the component otherwise.
  const { ref: hostRef, onLayout: reportLayout } = layout;
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onLayout?.(event);
      reportLayout?.(event);
    },
    [reportLayout, onLayout]
  );
  // Nothing to report and nothing to forward — in a release build that is the
  // usual case, and an attached handler would still cost a native dispatch.
  const layoutHandler = onLayout || reportLayout ? handleLayout : undefined;

  return (
    <View
      ref={hostRef}
      collapsable={false}
      className={className}
      pointerEvents={pointerEvents}
      style={style}
      onLayout={layoutHandler}>
      {children}
    </View>
  );
}
