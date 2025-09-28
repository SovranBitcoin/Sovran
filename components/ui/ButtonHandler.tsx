import React, { useState } from 'react';
import { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native';
import { Button } from 'components/ui/Button';
import Icon from 'assets/icons';
import { SheetManager } from 'react-native-actions-sheet';
import { HStack, View } from 'components/ui/View';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';

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
}

export function ButtonHandler({ context, buttons, style }: ButtonHandlerProps) {
  const [loading, setLoading] = useState(false);
  const theme = useSelector(memoizedGetTheme);

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
      spacing={8}
      className={`flex-row p-2 pb-10 ${context === 'tab' ? 'mb-12' : ''}`}
      style={[{ backgroundColor: greys(theme)[950] }, style]}>
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
        <View className="w-16">
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
