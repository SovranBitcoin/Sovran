import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { Screen } from '@/shared/ui/composed/Screen';
import { withAlpha } from '@/shared/lib/color';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

interface ScreenErrorStateProps {
  message: string;
  /** Optional title displayed above the message (e.g. "Error") */
  title?: string;
  onGoBack: () => void;
}

export function ScreenErrorState({ message, title, onGoBack }: ScreenErrorStateProps) {
  const foreground = useThemeColor('foreground');

  return (
    <Screen name="ScreenErrorState" scroll="none">
      <View style={{ flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' }}>
        {/* The alert groups only the text: an `accessible` container would
            swallow the Go Back button below into one non-actionable element. */}
        <View
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={title ? `${title}. ${message}` : message}>
          {title ? (
            <>
              <Text
                size={18}
                bold
                style={{
                  color: withAlpha(foreground, 0.9),
                  marginBottom: 16,
                  textAlign: 'center',
                }}>
                {title}
              </Text>
              <Text
                size={14}
                style={{
                  color: withAlpha(foreground, 0.5),
                  marginBottom: 24,
                  textAlign: 'center',
                }}>
                {message}
              </Text>
            </>
          ) : (
            <Text color={withAlpha(foreground, 0.66)}>{message}</Text>
          )}
        </View>
        <ButtonHandler
          buttons={[
            {
              text: 'Go Back',
              icon: 'ri:arrow-left-line',
              variant: 'primary',
              testID: 'screen-error-go-back',
              onPress: async () => onGoBack(),
            },
          ]}
        />
      </View>
    </Screen>
  );
}
