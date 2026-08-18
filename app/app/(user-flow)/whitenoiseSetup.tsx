import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { WhitenoiseSetupScreen } from '@/features/whitenoise/screens/WhitenoiseSetupScreen';

export default function WhitenoiseSetupPage() {
  const foreground = useThemeColor('foreground');
  return (
    <>
      <Stack.Screen options={{ title: 'White Noise', headerTitleStyle: { color: foreground } }} />
      <WhitenoiseSetupScreen />
    </>
  );
}
