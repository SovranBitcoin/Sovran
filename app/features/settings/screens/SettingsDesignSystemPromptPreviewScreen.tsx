/**
 * @fileoverview Design System · one prompt or screen, opened from the Prompts list.
 *
 * The app's own component fills the page. The only thing added is a close
 * button where the screen has no way out of its own, and a probe naming what
 * is on show.
 */

import { useState, type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CtaView } from '@/shared/blocks/CtaScreen';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { ZeroTopSafeArea } from '@/shared/hooks/useScreenInsets';
import { E2EAccessibilityProbe } from '@/shared/lib/e2e/E2EAccessibilityProbe';
import { headerButtonSize, spacing } from '@/shared/styles/tokens';
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

/**
 * Where the close button sits and where the page under it starts. The button
 * hangs just below the status bar; the page's own safe-area padding is moved
 * below the button, so a title or a top-right control of the page can never
 * sit under it.
 */
export function closePreviewFrame(statusBarInset: number): { buttonTop: number; pageTop: number } {
  const buttonTop = statusBarInset + spacing.sm;
  return { buttonTop, pageTop: buttonTop + headerButtonSize + spacing.xs };
}

/** A screen that, in the app, offers no way out, with the preview's close button above it. */
function WithClosePreview({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const frame = closePreviewFrame(insets.top);
  // The two values a class cannot carry: the status bar's height on this device
  // and the reserved top clearance below the close button. Padding the wrapper
  // directly guarantees both `scroll="auto"` and `scroll="custom"` screens start
  // below the close button, while zeroing the child's top safe-area inset keeps
  // `scroll="custom"` screens from double-padding.
  const pageInset = { paddingTop: frame.pageTop };
  const belowStatusBar = { top: frame.buttonTop };
  return (
    <>
      <View className="bg-surface flex-1" style={pageInset}>
        <ZeroTopSafeArea>{children}</ZeroTopSafeArea>
      </View>
      <View className="absolute right-3" style={belowStatusBar}>
        <ScreenHeaderAction
          icon="material-symbols:close-rounded"
          testID="ds-prompt-close"
          accessibilityLabel="Close preview"
          onPress={closePreview}
        />
      </View>
    </>
  );
}

export function SettingsDesignSystemPromptPreviewScreen({ entry }: { entry: ScreenPromptEntry }) {
  return (
    <View className="flex-1">
      {/* A page under a navigation title already has its back button. */}
      {entry.header ? (
        entry.render(closePreview)
      ) : (
        <WithClosePreview>{entry.render(closePreview)}</WithClosePreview>
      )}
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
  const view = (
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
  );
  return (
    <View className="flex-1">{blocking ? <WithClosePreview>{view}</WithClosePreview> : view}</View>
  );
}
