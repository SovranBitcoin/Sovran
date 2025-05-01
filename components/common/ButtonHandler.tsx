import { useState } from 'react';
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

interface ButtonHandlerProps {
  context?: 'tab';
  buttons: {
    disabled?: boolean;
    loading?: boolean;
    variant: 'primary' | 'secondary';
    icon?: string;
    text: string;
    onPress: any;
  }[];
  style?: StyleSheet;
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
      style={{
        flexDirection: 'row',
        padding: 8,
        paddingBottom: 16,
        marginBottom: context === 'tab' ? 48 : 0,
        ...style,
      }}>
      {buttons.slice(0, 2).map((button, index) => (
        <View key={index} className="flex-1 bg-transparent">
          <Button
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
            icon={<Icon name={'tabler:dots'} />}
            onPress={() => {
              SheetManager.show('button-handler', {
                context: 'modal',
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
