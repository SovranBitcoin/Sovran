import { Stack } from 'expo-router';

export default function StoriesFlowLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#000' },
      }}>
      <Stack.Screen name="stories" />
    </Stack>
  );
}
