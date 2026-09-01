import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

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
  const { ref: attachLayoutNode, onLayout: reportLayout } = useVisualLayoutLogger({
    enabled: visualDisabled !== true,
    scope: visualScope,
    surface: visualSurface,
    component: visualComponent,
    itemKey: visualKey ? visualLayoutScopePart(visualKey) : undefined,
    itemType: 'spinner',
    phase: visualPhase,
    extra: () => ({
      size,
      hasColor: !!color,
      ...(typeof visualExtra === 'function' ? visualExtra() : (visualExtra ?? {})),
    }),
  });

  return (
    <View
      ref={attachLayoutNode}
      collapsable={false}
      testID="spinner-loading-indicator"
      style={[styles.container, style]}
      onLayout={reportLayout}>
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
