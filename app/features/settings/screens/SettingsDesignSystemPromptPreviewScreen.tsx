/**
 * @fileoverview Design System · one prompt or screen, opened from the Prompts list.
 *
 * The app's own component fills the page. The only thing added is a close
 * button where the screen has no way out of its own, and a probe naming what
 * is on show.
 */

import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CtaView } from '@/shared/blocks/CtaScreen';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { spacing } from '@/shared/styles/tokens';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { View } from '@/shared/ui/primitives/View/View';

import type { CtaPromptEntry, ScreenPromptEntry } from '../design-system/prompts';

const NOTHING = () => {};

function closePreview(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/(settings-flow)/design-system-prompts');
}

function OnShowProbe({ id }: { id: string }) {
  return (
    <E2EAccessibilityProbe testID="ds-prompt-open" accessibilityLabel="Prompt on show" value={id} />
  );
}

/** Floats over a screen that, in the app, offers no way out. */
function ClosePreviewButton() {
  const insets = useSafeAreaInsets();
  // The one value a class cannot carry: the status bar's height on this device.
  const belowStatusBar = { top: insets.top + spacing.sm };
  return (
    <View className="absolute right-3" style={belowStatusBar}>
      <ScreenHeaderAction
        icon="material-symbols:close-rounded"
        testID="ds-prompt-close"
        accessibilityLabel="Close preview"
        onPress={closePreview}
      />
    </View>
  );
}

export function SettingsDesignSystemPromptPreviewScreen({ entry }: { entry: ScreenPromptEntry }) {
  return (
    <View className="flex-1">
      {entry.render(closePreview)}
      {/* A page under a navigation title already has its back button. */}
      {!entry.header && <ClosePreviewButton />}
      <OnShowProbe id={entry.id} />
    </View>
  );
}

/**
 * A prompt on its sample. The primary action does nothing; the others close
 * the preview, as they close the prompt in the app, and record nothing.
 */
export function SettingsDesignSystemCtaSampleScreen({ entry }: { entry: CtaPromptEntry }) {
  const [dontAsk, setDontAsk] = useState(false);
  const blocking = entry.cta.presentation === 'blocking-modal';
  return (
    <View className="flex-1">
      <CtaView
        cta={entry.cta}
        blocking={blocking}
        body={entry.sample.body}
        updateError={false}
        dontAsk={dontAsk}
        onDontAskChange={setDontAsk}
        onPrimary={NOTHING}
        onDismiss={closePreview}
        onDecline={closePreview}>
        <OnShowProbe id={entry.id} />
      </CtaView>
      {blocking && <ClosePreviewButton />}
    </View>
  );
}
