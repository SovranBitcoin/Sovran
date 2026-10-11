import { Redirect, Stack, useLocalSearchParams } from 'expo-router';

import { SettingsDesignSystemPromptPreviewScreen, findPromptEntry } from '@/features/settings';

export default function DesignSystemPromptRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const entry = typeof id === 'string' ? findPromptEntry(id) : undefined;
  if (entry?.kind !== 'screen') return <Redirect href="/(settings-flow)/design-system-prompts" />;
  return (
    <>
      {entry.header && <Stack.Screen options={{ headerShown: true, title: entry.header }} />}
      <SettingsDesignSystemPromptPreviewScreen key={entry.id} entry={entry} />
    </>
  );
}
