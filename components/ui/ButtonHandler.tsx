import React, { useState } from 'react';
import { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native';
import { Button } from 'components/ui/Button';
import { SheetManager } from 'react-native-actions-sheet';
import { HStack, View } from 'components/ui/View';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from 'providers/ThemeProvider';
import opacity from 'hex-color-opacity';
import Icon from '@/assets/icons';

export interface ButtonHandlerButton {
  testID?: string;
  disabled?: boolean;
  loading?: boolean;
  variant: 'primary' | 'secondary' | 'dangerous';
  icon?: string;
  text: string;
  onPress: (close: (event: GestureResponderEvent) => void) => Promise<void>;
  condition?: boolean;
}

interface ButtonHandlerProps {
  context?: 'tab' | 'sheet';
  buttons: ButtonHandlerButton[];
  style?: StyleProp<ViewStyle>;
  gradientColor?: string;
  className?: string;
}

export function ButtonHandler({
  context,
  buttons,
  style,
  gradientColor,
  className,
}: ButtonHandlerProps) {
  const [loading, setLoading] = useState(false);
  const { getPrimaryColor } = useTheme();

  // Filter buttons based on condition
  const visibleButtons = buttons.filter((button) => button.condition !== false);

  const handleButtonPress = async (button: ButtonHandlerButton) => {
    if (button.disabled) return;

    setLoading(true);
    try {
      await button.onPress(() => {});
    } finally {
      setLoading(false);
    }
  };

  const handleMorePress = async () => {
    if (visibleButtons.length === 3) {
      await handleButtonPress(visibleButtons[2]);
    } else {
      SheetManager.show('button-handler', {
        payload: { buttons: visibleButtons },
      });
    }
  };

  return (
    <HStack
      align="center"
      justify="space-between"
      spacing={0}
      className={`flex-row p-2 pb-4 ${context === 'tab' ? 'mb-12' : ''} ${className || ''}`}
      style={[style]}>
      <LinearGradient
        colors={[
          opacity(gradientColor || getPrimaryColor('950'), 0.75),
          opacity(gradientColor || getPrimaryColor('950'), 0),
        ]}
        start={{ x: 0, y: 1 }}
        end={{ x: 0, y: 0 }}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
        }}
      />

      {visibleButtons.slice(0, 2).map((button, index) => (
        <View key={index} className="flex-1">
          <Button
            testID={button.testID}
            onPress={() => handleButtonPress(button)}
            text={button.text}
            variant={button.variant}
            loading={loading || button.loading}
            disabled={button.disabled}
          />
        </View>
      ))}

      {/* More button (if more than 2 buttons) */}
      {visibleButtons.length > 2 && (
        <View>
          <Button
            testID="more-button"
            icon={
              visibleButtons.length === 3 && visibleButtons[2].icon ? (
                <Icon name={visibleButtons[2].icon} />
              ) : (
                <Icon name="tabler:dots" />
              )
            }
            onPress={handleMorePress}
            variant="secondary"
            loading={loading}
            disabled={visibleButtons.length === 3 && visibleButtons[2].disabled}
          />
        </View>
      )}
    </HStack>
  );
}
