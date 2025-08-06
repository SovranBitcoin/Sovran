import React, { useState } from 'react';
import { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native';
import { Button } from 'components/common/Button';
import Icon from 'assets/icons';
import { SheetManager } from 'react-native-actions-sheet';
import { View } from 'components/common/View';
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
  onPress: (close: (event: GestureResponderEvent) => void) => Promise<void>;
  condition?: boolean; // New optional prop for conditional rendering
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
    opacity(greys(theme)[950], 0),
    opacity(greys(theme)[950], 0.75),
    opacity(greys(theme)[950], 0.9),
    greys(theme)[950],
  ] as const;

  // Filter buttons based on condition (default to true if condition is undefined)
  const visibleButtons = buttons.filter((button) => button.condition !== false);

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
      {visibleButtons.slice(0, 2).map((button, index) => (
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

      {visibleButtons.length > 2 && (
        <View className="w-16 bg-transparent">
          <Button
            testID="more-button"
            icon={
              visibleButtons.length === 3 && visibleButtons[2].icon ? (
                <Icon name={visibleButtons[2].icon} />
              ) : (
                <Icon name={'tabler:dots'} />
              )
            }
            onPress={() => {
              if (visibleButtons.length === 3) {
                runWithAnimationFrame(visibleButtons[2].onPress, setLoading)();
              } else {
                SheetManager.show('button-handler', {
                  payload: { buttons: visibleButtons },
                });
              }
            }}
            variant="secondary"
            loading={loading}
            disabled={visibleButtons.length === 3 && visibleButtons[2].disabled}
          />
        </View>
      )}
    </LinearGradient>
  );
}
