/**
 * The canonical zap chooser. The feed/thread zap button opens this: one row
 * per preset (emoji + canned message + sat amount) that opens the melt
 * preview prefilled for confirmation, plus a "Custom amount…" row that goes
 * through the amount screen first.
 *
 * Menu-lane note: this only ever opens from feed/thread routes
 * (slideFromRight), where `actionMenuPopup` is visible. Both paths navigate
 * away BEFORE the native send-flow modal opens, so the invisible-menu trap
 * (menus inside iOS route modals) is avoided by design.
 */
import React from 'react';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';
import { AnimatedEmoji } from '@/shared/ui/primitives/AnimatedEmoji';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats } from '../components/nostr/feedFormat';
import { ZAP_PRESETS, type ZapPreset } from './zapPresets';

function ZapAmountSuffix({ sats }: { sats: number }) {
  const muted = useThemeColor('muted');
  return (
    <Text style={{ color: muted, fontVariant: ['tabular-nums'] }}>{formatSats(sats)} sats</Text>
  );
}

export function openZapMenu({
  onPreset,
  onCustom,
}: {
  /** Opens the melt preview prefilled with the preset; the menu closes first. */
  onPreset: (preset: ZapPreset) => void;
  onCustom: () => void;
}): void {
  actionMenuPopup({
    title: 'Zap',
    buttons: [
      ...ZAP_PRESETS.map((preset) => ({
        // The animated emoji is the row icon; strip it from the displayed
        // message so it doesn't render twice. The zap COMMENT keeps the full
        // message (emoji included) — that's what the recipient sees.
        text: preset.message.replace(preset.emoji, '').trim(),
        iconNode: <AnimatedEmoji emoji={preset.emoji} size={28} />,
        suffix: <ZapAmountSuffix sats={preset.sats} />,
        testID: `zap-preset-${preset.sats}`,
        onPress: (close: () => void) => {
          close();
          onPreset(preset);
        },
      })),
      {
        text: 'Custom amount…',
        icon: 'mingcute:lightning-fill',
        separator: true,
        testID: 'zap-custom',
        onPress: (close: () => void) => {
          close();
          onCustom();
        },
      },
    ],
  });
}
