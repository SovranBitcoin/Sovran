import React from 'react';
import { StyleSheet } from 'react-native';
import { LiquidButtonView } from 'expo-liquid-glass-native';
import { hasAndroidLiquidButtonView } from '@/navigation/nativeTabs';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

export interface QRButtonProps {
  onPress: () => void;
  accentColor?: string;
  color?: string;
  size?: number;
}

const DEFAULT_SIZE = 72;
const INVISIBLE_TITLE = '\u2007'.repeat(1);

export function QRButton(props: QRButtonProps): React.ReactElement {
  const [foreground, shadeColor300] = useThemeColor(['foreground', 'shade-300'] as const);
  const { onPress, accentColor = shadeColor300, color = foreground, size = DEFAULT_SIZE } = props;

  if (hasAndroidLiquidButtonView()) {
    return (
      <View
        className="overflow-hidden"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          transform: [{ scale: 1.3 }],
        }}>
        <LiquidButtonView
          title={INVISIBLE_TITLE}
          enabled
          tint={accentColor}
          blurRadius={4}
          lensX={24}
          lensY={24}
          onPress={onPress}
          style={{ width: '100%', height: '100%' }}
        />
        <View
          pointerEvents="none"
          className="absolute inset-0 items-center justify-center"
          style={{ elevation: 1 }}>
          <Icon name="stash:qr-code" size={24} color={color} />
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[
        styles.touchable,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          shadowColor: accentColor,
          borderColor: opacity(accentColor, 0.35),
        },
      ]}
      className="items-center justify-center"
      haptics={{ type: 'impact', impactStyle: 'light' }}
      activeOpacity={0.85}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      onPress={onPress}>
      <BlurCardFrame accentColor={accentColor}>
        <View style={styles.content}>
          <Icon name="stash:qr-code" size={24} color={color} />
        </View>
      </BlurCardFrame>
    </TouchableOpacity>
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
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
});
