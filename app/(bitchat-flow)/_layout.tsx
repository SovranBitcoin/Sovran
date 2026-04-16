import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

export default function BitChatFlowLayout() {
  const [background, foreground] = useThemeColor(['background', 'foreground'] as const);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: background },
        headerTintColor: foreground,
        headerBackTitle: 'Back',
      }}
    />
  );
}
