import { useState } from 'react';
import { Slider } from 'heroui-native';

import {
  SCRUB_STOPS,
  SCRUB_TRANSITIONS,
  ScrubbedFrame,
  type ScrubTransition,
  type ScrubTransitionId,
} from '@/features/settings/design-system/scrubber';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { Section } from '@/shared/ui/composed/Section';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

type Frames = Record<ScrubTransitionId, number>;

const START = Object.fromEntries(
  SCRUB_TRANSITIONS.map((transition) => [transition.id, 0])
) as Frames;

/** The slider's resolution: a tenth of a percent. */
const SLIDER_STEP = 0.1;

/** Whether `value` (0..1) sits exactly on `stop` (percent), to the slider's resolution. */
function isAtStop(value: number, stop: number): boolean {
  return Math.round(value * 1000) === stop * 10;
}

function percentLabel(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function StopButtons({
  testIDPrefix,
  label,
  value,
  onSelect,
}: {
  testIDPrefix: string;
  label: string;
  /** The current frame, or null when there is no single one (the transitions differ). */
  value: number | null;
  onSelect: (value: number) => void;
}) {
  return (
    <View className="flex-row gap-2">
      {SCRUB_STOPS.map((stop) => {
        const active = value !== null && isAtStop(value, stop);
        return (
          <Pressable
            key={stop}
            testID={`${testIDPrefix}-${stop}`}
            accessibilityRole="button"
            accessibilityLabel={`${label} at ${stop}%`}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(stop / 100)}
            className={`h-11 flex-1 items-center justify-center rounded-full ${
              active ? 'bg-accent' : 'bg-surface-secondary'
            }`}>
            <Text
              size={13}
              semibold
              className={active ? 'text-accent-foreground' : 'text-foreground'}>
              {`${stop}%`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FrameSlider({
  testID,
  label,
  value,
  onChange,
}: {
  testID: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <View testID={testID}>
      <Slider
        value={value * 100}
        minValue={0}
        maxValue={100}
        step={SLIDER_STEP}
        aria-label={label}
        onChange={(next: number | number[]) => {
          const percent = Array.isArray(next) ? (next[0] ?? 0) : next;
          onChange(percent / 100);
        }}>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
    </View>
  );
}

function TransitionScrubber({
  transition,
  value,
  onChange,
}: {
  transition: ScrubTransition;
  value: number;
  onChange: (id: ScrubTransitionId, value: number) => void;
}) {
  const prefix = `design-system-scrub-${transition.id}`;
  const select = (next: number) => onChange(transition.id, next);

  return (
    <Section title={transition.title}>
      <View testID={prefix} className="gap-3">
        <View className="flex-row justify-between">
          <Text size={12} className="text-foreground/60">{`0% · ${transition.from}`}</Text>
          <Text size={12} className="text-foreground/60">{`${transition.to} · 100%`}</Text>
        </View>
        <ScrubbedFrame transition={transition} value={value} />
        <Text size={13} semibold className="text-center tabular-nums" testID={`${prefix}-value`}>
          {percentLabel(value)}
        </Text>
        <StopButtons
          testIDPrefix={prefix}
          label={transition.title}
          value={value}
          onSelect={select}
        />
        <FrameSlider
          testID={`${prefix}-slider`}
          label={`${transition.title} frame`}
          value={value}
          onChange={select}
        />
      </View>
    </Section>
  );
}

export function SettingsDesignSystemScrubberScreen() {
  const [frames, setFrames] = useState<Frames>(START);
  const [master, setMaster] = useState(0);
  const values = SCRUB_TRANSITIONS.map((transition) => frames[transition.id]);
  const shared = values.every((value) => value === values[0]) ? values[0] : null;

  const scrubAll = (value: number) => {
    setMaster(value);
    setFrames(
      Object.fromEntries(SCRUB_TRANSITIONS.map((transition) => [transition.id, value])) as Frames
    );
  };
  const scrubOne = (id: ScrubTransitionId, value: number) =>
    setFrames((current) => ({ ...current, [id]: value }));

  return (
    <ScreenWrapper name="SettingsDesignSystemScrubberScreen" scroll="custom" safeArea="scroll">
      <ScreenScrollView className="px-4" bottomSpacing={32}>
        <Text size={12} className="text-foreground/60 mb-4 mt-2">
          Hold any frame of a transition still. Each one is driven from here instead of its own
          timing, so a frame stays exactly where you put it.
        </Text>
        <Section title="Scrub all">
          <View testID="design-system-scrub-all" className="gap-3">
            <Text
              size={13}
              semibold
              className="text-center tabular-nums"
              testID="design-system-scrub-all-value">
              {shared === null ? 'Mixed' : percentLabel(shared)}
            </Text>
            <StopButtons
              testIDPrefix="design-system-scrub-all"
              label="Every transition"
              value={shared}
              onSelect={scrubAll}
            />
            <FrameSlider
              testID="design-system-scrub-all-slider"
              label="Every transition frame"
              // Follows the transitions once they agree again (each moved to
              // the same stop by hand); while they differ it stays put.
              value={shared ?? master}
              onChange={scrubAll}
            />
          </View>
        </Section>
        {SCRUB_TRANSITIONS.map((transition) => (
          <TransitionScrubber
            key={transition.id}
            transition={transition}
            value={frames[transition.id]}
            onChange={scrubOne}
          />
        ))}
      </ScreenScrollView>
    </ScreenWrapper>
  );
}
