/**
 * @fileoverview Design System · Prompts.
 *
 * One list of every prompt, every screen that stops the app, the first-launch
 * screens and the deletion confirmations. A row opens the real thing on sample
 * data (`design-system/prompts.tsx`); nothing opened from here changes the
 * wallet, the accounts or what the app remembers.
 */

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { SectionHeading } from '@/shared/ui/composed/SectionHeading';
import { Surface, useSurfaceInset } from '@/shared/ui/composed/Surface';
import { Text } from '@/shared/ui/primitives/Text';

import { PROMPT_GROUPS, type PromptEntry } from '../design-system/prompts';

function openPrompt(entry: PromptEntry): void {
  if (entry.kind === 'menu') {
    entry.open();
    return;
  }
  // A prompt opens in the prompt flow, as it does in the app; a screen opens
  // as a page of its own.
  router.navigate({
    pathname:
      entry.kind === 'cta' ? '/(prompt-flow)/cta-sample' : '/(settings-flow)/design-system-prompt',
    params: { id: entry.id },
  });
}

export function SettingsDesignSystemPromptsScreen() {
  return (
    <ScreenWrapper name="SettingsDesignSystemPromptsScreen" scroll="custom" safeArea="scroll">
      <ScreenScrollView contentContainerClassName="gap-6 px-4">
        <Text size={13} className="text-foreground/60">
          The app&apos;s own prompts and blocking screens on made-up data. Nothing opened here
          changes your wallet, your accounts or what the app remembers.
        </Text>
        {PROMPT_GROUPS.map((group) => (
          <Surface key={group.id} testID={`ds-prompts-group-${group.id}`}>
            <SectionHeading label={group.title} detail={String(group.entries.length)} />
            {group.entries.map((entry) => (
              <PromptRow key={entry.id} entry={entry} />
            ))}
          </Surface>
        ))}
      </ScreenScrollView>
    </ScreenWrapper>
  );
}

function PromptRow({ entry }: { entry: PromptEntry }) {
  // Inside the surface, so the row shares the heading's left edge.
  const inset = useSurfaceInset();
  return (
    <ListRow
      paddingHorizontal={inset}
      title={entry.title}
      subtitle={entry.detail}
      testID={`ds-prompt-${entry.id}`}
      onPress={() => openPrompt(entry)}
      accessibilityLabel={`${entry.title}. ${entry.detail}`}
    />
  );
}
