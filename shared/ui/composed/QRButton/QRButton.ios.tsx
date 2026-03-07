import React from 'react';
import { StyleSheet } from 'react-native';
import { PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { QRButtonLiquid } from './QRButton.liquid';

export interface QRButtonProps {
  onPress: () => void;
  accentColor?: string;
  color?: string;
  size?: number;
}

const DEFAULT_SIZE = 72;

export function QRButton(props: QRButtonProps): React.ReactElement {
  const [foreground, shadeColor100, shadeColor300] = useThemeColor([
    'foreground',
    'shade-100',
    'shade-300',
  ] as const);
  const { onPress, accentColor = shadeColor100, color = foreground, size = DEFAULT_SIZE } = props;

  if (supportsLiquidGlass()) {
    return (
      <QRButtonLiquid
        onPress={onPress}
        accentColor={accentColor}
        color={shadeColor300}
        size={size}
      />
    );
  }

  return (
    <View
      style={[
        styles.touchable,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          shadowColor: accentColor,
          borderColor: opacity(accentColor, 0.35),
        },
      ]}>
      <BlurCardFrame accentColor={accentColor}>
        <PressableFeedback
          animation={false}
          onPress={onPress}
          style={[
            styles.pressable,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
            },
          ]}>
          <View
            style={[
              styles.content,
              {
                backgroundColor: opacity(shadeColor300, 0.1),
                width: size,
                height: size,
                borderRadius: size / 2,
              },
            ]}>
            <Icon name="stash:qr-code" size={24} color={color} />
          </View>
          <PressableFeedback.Ripple />
        </PressableFeedback>
      </BlurCardFrame>
    </View>
  );
}

const styles = StyleSheet.create({
  touchable: {
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 6,
  },
  pressable: {
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
