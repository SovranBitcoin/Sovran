import { Stack } from 'expo-router';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { createFlowLayoutScreenOptions } from '@/config/flowLayoutOptions';

export default function BitChatFlowLayout() {
  const [background, foreground] = useThemeColor(['background', 'foreground'] as const);
  return <Stack screenOptions={createFlowLayoutScreenOptions({ foreground, background })} />;
}
