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

export function ButtonHandler({ context, buttons, style = {}, colors }) {
  const [loading, setLoading] = useState(false);
  const theme = useSelector(memoizedGetTheme);

  return (
    <LinearGradient
      colors={
        colors || [
          opacity(greys(theme)[2300], 0),
          opacity(greys(theme)[2300], 0.75),
          opacity(greys(theme)[2300], 0.9),
          greys(theme)[2300],
        ]
      }
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 8,
        paddingBottom: 16,
        marginBottom: context === 'tab' ? 48 : 0,
        ...style,
      }}>
      {buttons.slice(0, 2).map((button, index) => (
        <View
          key={index}
          style={{
            flex: 1,
            backgroundColor: 'transparent',
          }}>
          <Button
            position="center"
            onPress={() => {
              // Only run the onPress if the button is not disabled
              if (!button.disabled) {
                runWithAnimationFrame(button.onPress, setLoading)();
              }
            }}
            text={button.text}
            variant={button.variant}
            loading={loading || button.loading}
            disabled={button.disabled} // Pass the disabled prop to Button
            // icon={button.icon}
          />
        </View>
      ))}

      {buttons.length > 2 && (
        <View
          style={{
            backgroundColor: 'transparent',
            width: 64,
          }}>
          <Button
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
