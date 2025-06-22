import React, { useState } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Button } from 'components/common/Button';
import Icon from 'assets/icons';
import { SheetManager } from 'react-native-actions-sheet';
import { View } from 'components/common/Themed';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { runWithAnimationFrame } from 'app/onboard/new';

export interface ButtonHandlerButton {
  testID?: string | undefined;
  disabled?: boolean;
  loading?: boolean;
  variant: 'primary' | 'secondary' | 'dangerous';
  icon?: string;
  text: string;
  onPress: any;
}

interface ButtonHandlerProps {
  context?: 'tab' | 'sheet';
  buttons: ButtonHandlerButton[];
  style?: StyleProp<ViewStyle>;
  colors?: readonly [string, string, ...string[]];
}

export function ButtonHandler({ context, buttons, style, colors }: ButtonHandlerProps) {
  const [loading, setLoading] = useState(false);
  const theme = useSelector(memoizedGetTheme);

  const defaultColors: readonly [string, string, ...string[]] = [
    opacity(greys(theme)[2300], 0),
    opacity(greys(theme)[2300], 0.75),
    opacity(greys(theme)[2300], 0.9),
    greys(theme)[2300],
  ] as const;

  return (
    <LinearGradient
      colors={colors || defaultColors}
      style={[
        {
          flexDirection: 'row',
          padding: 8,
          paddingBottom: 38,
          marginBottom: context === 'tab' ? 48 : 0,
        },
        style,
      ]}>
      {buttons.slice(0, 2).map((button, index) => (
        <View key={index} className="flex-1 bg-transparent">
          <Button
            testID={button.testID}
            onPress={() => {
              if (!button.disabled) {
                runWithAnimationFrame(button.onPress, setLoading)();
              }
            }}
            text={button.text}
            variant={button.variant}
            loading={loading || button.loading}
            disabled={button.disabled}
          />
        </View>
      ))}

      {buttons.length > 2 && (
        <View className="w-16 bg-transparent">
          <Button
            testID="more-button"
            icon={<Icon name={'tabler:dots'} />}
            onPress={() => {
              SheetManager.show('button-handler', {
                payload: { buttons },
              });
            }}
            variant="secondary"
            loading={loading}
          />
        </View>
      )}
    </LinearGradient>
  );
}
