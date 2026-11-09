/**
 * The canonical zap chooser. The feed/thread zap button opens this: one row
 * per preset (emoji + canned message + sat amount) that opens the melt
 * preview prefilled for confirmation, plus a "Custom amount…" row that goes
 * through the amount screen first.
 *
 * It opens in the picker sheet, and acts only once the sheet has gone: both
 * rows open the send flow, which must not start under a closing sheet.
 */

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { openPicker } from '@/shared/lib/picker/openPicker';
import { AnimatedEmoji, prefetchAnimatedEmojis } from '@/shared/ui/primitives/AnimatedEmoji';
import { Text } from '@/shared/ui/primitives/Text';

import { formatSats } from '../components/nostr/feedFormat';
import { ZAP_PRESETS, type ZapPreset } from './zapPresets';

const CUSTOM_ID = 'custom';

function ZapAmountSuffix({ sats }: { sats: number }) {
  const muted = useThemeColor('muted');
  return (
    <Text style={{ color: muted, fontVariant: ['tabular-nums'] }}>{formatSats(sats)} sats</Text>
  );
}

export async function openZapMenu({
  onPreset,
  onCustom,
}: {
  /** Opens the melt preview prefilled with the preset. */
  onPreset: (preset: ZapPreset) => void;
  onCustom: () => void;
}): Promise<void> {
  void prefetchAnimatedEmojis(ZAP_PRESETS.map((preset) => preset.emoji));
  const picker = openPicker({
    title: 'Zap',
    options: [
      ...ZAP_PRESETS.map((preset) => ({
        id: String(preset.sats),
        // The animated emoji is the row icon; strip it from the displayed
        // message so it doesn't render twice. The zap COMMENT keeps the full
        // message (emoji included) — that's what the recipient sees.
        title: preset.message.replace(preset.emoji, '').trim(),
        leading: { node: <AnimatedEmoji emoji={preset.emoji} size={28} /> },
        trailing: <ZapAmountSuffix sats={preset.sats} />,
        testID: `zap-preset-${preset.sats}`,
      })),
      {
        id: CUSTOM_ID,
        title: 'Custom amount…',
        leading: { icon: { name: 'mingcute:lightning-fill' } },
        testID: 'zap-custom',
      },
    ],
  });
  const result = await picker.result;
  if (result.kind !== 'option') return;
  await picker.closed;
  if (result.id === CUSTOM_ID) {
    onCustom();
    return;
  }
  const preset = ZAP_PRESETS.find((candidate) => String(candidate.sats) === result.id);
  if (preset) onPreset(preset);
}
