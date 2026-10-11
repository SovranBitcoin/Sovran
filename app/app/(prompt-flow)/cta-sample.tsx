import { Redirect, Stack, useLocalSearchParams } from 'expo-router';

import { SettingsDesignSystemCtaSampleScreen, findPromptEntry } from '@/features/settings';

/** A prompt on sample data, opened from the design system. It reads and records nothing. */
export default function CtaSampleRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const entry = typeof id === 'string' ? findPromptEntry(id) : undefined;
  if (entry?.kind !== 'cta') return <Redirect href="/" />;
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SettingsDesignSystemCtaSampleScreen key={entry.id} entry={entry} />
    </>
  );
}
