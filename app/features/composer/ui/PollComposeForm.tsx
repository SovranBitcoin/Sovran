/**
 * @fileoverview Poll authoring form (shown in the composer when poll mode is on).
 *
 * 2–5 options (add/remove), single- vs multiple-choice, and a discrete duration
 * picker. The composer's text becomes the poll question; this edits the
 * `PollDraft` on the composer store.
 */
import { useCallback } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import Icon from 'assets/icons';
import { withAlpha } from '@/shared/lib/color';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { useComposerStore } from '@/features/composer/state/composerStore';
import type { PollDraft } from '@/features/composer/config/types';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;

const DURATIONS: { label: string; spoken: string; secs: number }[] = [
  { label: 'No limit', spoken: 'No time limit', secs: 0 },
  { label: '1h', spoken: '1 hour', secs: 3600 },
  { label: '6h', spoken: '6 hours', secs: 21600 },
  { label: '1d', spoken: '1 day', secs: 86400 },
  { label: '3d', spoken: '3 days', secs: 259200 },
  { label: '1w', spoken: '1 week', secs: 604800 },
];

let optionSeq = 0;
const newOptionId = (): string => `o${(optionSeq += 1)}_${Math.floor(Math.random() * 1e6)}`;

/** A fresh 2-option single-choice poll draft. */
export function emptyPollDraft(): PollDraft {
  return {
    options: [
      { id: newOptionId(), label: '' },
      { id: newOptionId(), label: '' },
    ],
    type: 'singlechoice',
  };
}

export function PollComposeForm() {
  const poll = useComposerStore((s) => s.poll);
  const setPoll = useComposerStore((s) => s.setPoll);
  const [foreground, muted, accent] = useThemeColor(['foreground', 'muted', 'accent'] as const);

  const update = useCallback((next: PollDraft) => setPoll(next), [setPoll]);

  if (!poll) return null;

  const selectedDuration =
    poll.endsAt === undefined ? 0 : Math.max(0, poll.endsAt - Math.floor(Date.now() / 1000));

  return (
    <View style={[styles.container, { borderColor: withAlpha(foreground, 0.12) }]}>
      <View style={styles.header}>
        <Text size={13} bold style={{ color: muted }}>
          POLL
        </Text>
        <Pressable
          onPress={() => setPoll(undefined)}
          testID="composer-poll-remove"
          accessibilityRole="button"
          accessibilityLabel="Remove poll">
          <Icon name="mdi:close" size={18} color={muted} />
        </Pressable>
      </View>

      {poll.options.map((option, index) => (
        <View key={option.id} style={styles.optionRow}>
          <TextInput
            testID={`composer-poll-option-${option.id}`}
            accessibilityLabel={`Option ${index + 1}`}
            value={option.label}
            onChangeText={(label) =>
              update({
                ...poll,
                options: poll.options.map((o) => (o.id === option.id ? { ...o, label } : o)),
              })
            }
            placeholder={`Option ${index + 1}`}
            placeholderTextColor={muted}
            style={[styles.input, { color: foreground, borderColor: withAlpha(foreground, 0.12) }]}
          />
          {poll.options.length > MIN_OPTIONS ? (
            <Pressable
              onPress={() =>
                update({ ...poll, options: poll.options.filter((o) => o.id !== option.id) })
              }
              testID={`composer-poll-option-remove-${option.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Remove option ${index + 1}`}>
              <Icon name="mdi:minus-circle-outline" size={20} color={muted} />
            </Pressable>
          ) : null}
        </View>
      ))}

      {poll.options.length < MAX_OPTIONS ? (
        <Pressable
          onPress={() =>
            update({ ...poll, options: [...poll.options, { id: newOptionId(), label: '' }] })
          }
          testID="composer-poll-option-add"
          accessibilityRole="button"
          accessibilityLabel="Add option"
          style={styles.addRow}>
          <Icon name="mdi:plus" size={18} color={accent} />
          <Text size={14} style={{ color: accent }}>
            Add option
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.chipRow}>
        {(['singlechoice', 'multiplechoice'] as const).map((type) => (
          <Chip
            key={type}
            testID={`composer-poll-type-${type}`}
            label={type === 'singlechoice' ? 'Single choice' : 'Multiple choice'}
            active={poll.type === type}
            onPress={() => update({ ...poll, type })}
            accent={accent}
            foreground={foreground}
            muted={muted}
          />
        ))}
      </View>

      <Text size={12} style={{ color: muted, marginTop: 8 }}>
        Duration
      </Text>
      <View style={styles.chipRow}>
        {DURATIONS.map((d) => (
          <Chip
            key={d.secs}
            testID={`composer-poll-duration-${d.secs}`}
            label={d.label}
            accessibilityLabel={`Duration: ${d.spoken}`}
            active={
              d.secs === 0 ? poll.endsAt === undefined : Math.abs(selectedDuration - d.secs) < 60
            }
            onPress={() =>
              update({
                ...poll,
                endsAt: d.secs === 0 ? undefined : Math.floor(Date.now() / 1000) + d.secs,
              })
            }
            accent={accent}
            foreground={foreground}
            muted={muted}
          />
        ))}
      </View>
    </View>
  );
}

function Chip({
  testID,
  label,
  accessibilityLabel,
  active,
  onPress,
  accent,
  foreground,
  muted,
}: {
  testID: string;
  label: string;
  accessibilityLabel?: string;
  active: boolean;
  onPress: () => void;
  accent: string;
  foreground: string;
  muted: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: active, checked: active }}
      style={[
        styles.chip,
        {
          borderColor: active ? accent : withAlpha(foreground, 0.18),
          backgroundColor: active ? withAlpha(accent, 0.15) : 'transparent',
        },
      ]}>
      <Text size={13} style={{ color: active ? accent : muted }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 3 },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
