import { useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { LoadingIndicator } from '@/shared/blocks/status';
import {
  useVisualLayoutLogger,
  visualLayoutScopePart,
  type VisualLayoutConfig,
} from '@/shared/lib/contentShiftLog';

type SpinnerVisualProps = {
  visualScope?: string;
  visualKey?: string;
  visualSurface?: string;
  visualComponent?: string;
  visualPhase?: string;
  visualExtra?: VisualLayoutConfig['extra'];
  visualDisabled?: boolean;
};

type SpinnerProps = {
  size?: number;
  style?: StyleProp<ViewStyle>;
  color?: string;
} & SpinnerVisualProps;

let spinnerVisualInstance = 0;

export function Spinner({
  size = 8,
  style,
  color,
  visualScope = 'loading.spinner',
  visualKey,
  visualSurface = 'shared',
  visualComponent = 'Spinner',
  visualPhase = 'loading',
  visualExtra,
  visualDisabled,
}: SpinnerProps) {
  const instanceKeyRef = useRef<string | null>(null);
  if (instanceKeyRef.current === null) {
    spinnerVisualInstance += 1;
    instanceKeyRef.current = `spinner:${spinnerVisualInstance}`;
  }
  const layout = useVisualLayoutLogger({
    enabled: visualDisabled !== true,
    scope: visualScope,
    surface: visualSurface,
    component: visualComponent,
    itemKey: visualKey ? visualLayoutScopePart(visualKey) : instanceKeyRef.current,
    itemType: 'spinner',
    phase: visualPhase,
    extra: () => ({
      size,
      hasColor: !!color,
      ...(typeof visualExtra === 'function' ? visualExtra() : (visualExtra ?? {})),
    }),
  });
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      layout.onLayout(event);
    },
    [layout]
  );

  return (
    <View
      ref={layout.ref}
      collapsable={false}
      testID="spinner-loading-indicator"
      style={[styles.container, style]}
      onLayout={handleLayout}>
      <LoadingIndicator size={size} phase="loading" color={color} visualDisabled />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
