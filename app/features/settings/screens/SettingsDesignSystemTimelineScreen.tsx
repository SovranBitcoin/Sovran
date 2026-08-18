import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { Button, Card } from 'heroui-native';

import { getDesignSystemFamily } from '@/features/settings/design-system/catalog';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { HistoryEntryTimeline } from '@/features/transactions';
import { UnderlineTabs } from '@/shared/ui/composed/UnderlineTabs';
import { PillTabs, PILL_TABS_HEIGHT } from '@/shared/ui/composed/PillTabs';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

import {
  buildTimelineScenarios,
  describeFrameState,
  type TimelineScenarioGroup,
} from './designSystemTimelineScenarios';

const TIMELINE_FRAME_DURATION_MS = 1500;
const TIMELINE_COMPLETE_HOLD_STEPS = 2;
const TIMELINE_FAMILY = getDesignSystemFamily('timeline');

export function SettingsDesignSystemTimelineScreen() {
  // Fixed createdAt so the simulated timestamps don't churn on re-render.
  const timelineCreatedAt = useMemo(() => Date.now() - 5 * 60 * 1000, []);
  const timelineScenarios = useMemo(
    () => buildTimelineScenarios(timelineCreatedAt),
    [timelineCreatedAt]
  );
  const [selectedScenarioId, setSelectedScenarioId] = useState(timelineScenarios[0].id);
  const [frameIndex, setFrameIndex] = useState(0);
  const [timelineAuto, setTimelineAuto] = useState(true);
  const [loopIteration, setLoopIteration] = useState(0);
  const timelineCycleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timelineHoldRef = useRef(0);
  const [separator] = useThemeColor(['separator'] as const);

  const selectedScenario =
    timelineScenarios.find((s) => s.id === selectedScenarioId) ?? timelineScenarios[0];
  // Receive-hub chrome: method groups as top-level underline tabs, the
  // group's scenario variants (Success / Rollback / …) as the pill row.
  const groups = useMemo(
    () => [...new Set(timelineScenarios.map((s) => s.group))],
    [timelineScenarios]
  );
  const groupScenarios = useMemo(
    () => timelineScenarios.filter((s) => s.group === selectedScenario.group),
    [selectedScenario.group, timelineScenarios]
  );
  const variants = groupScenarios.map((s) => s.variant);
  const frameCount = selectedScenario.frames.length;
  const currentFrame = selectedScenario.frames[Math.min(frameIndex, frameCount - 1)];
  const frameState = describeFrameState(currentFrame);

  useEffect(() => {
    if (!timelineAuto) {
      if (timelineCycleRef.current) clearInterval(timelineCycleRef.current);
      timelineCycleRef.current = null;
      return;
    }

    timelineHoldRef.current = 0;
    timelineCycleRef.current = setInterval(() => {
      setFrameIndex((index) => {
        if (index >= frameCount - 1) {
          if (timelineHoldRef.current < TIMELINE_COMPLETE_HOLD_STEPS) {
            timelineHoldRef.current += 1;
            return index;
          }

          timelineHoldRef.current = 0;
          setLoopIteration((value) => value + 1);
          return 0;
        }

        timelineHoldRef.current = 0;
        return index + 1;
      });
    }, TIMELINE_FRAME_DURATION_MS);

    return () => {
      if (timelineCycleRef.current) clearInterval(timelineCycleRef.current);
      timelineCycleRef.current = null;
    };
  }, [frameCount, selectedScenarioId, timelineAuto]);

  const onSelectScenario = (id: string) => {
    setSelectedScenarioId(id);
    setFrameIndex(0);
    setLoopIteration((value) => value + 1);
    setTimelineAuto(true);
  };
  const onSelectGroup = (group: string) => {
    const first = timelineScenarios.find((s) => s.group === (group as TimelineScenarioGroup));
    if (first && first.group !== selectedScenario.group) onSelectScenario(first.id);
  };
  const onSelectVariant = (variant: string) => {
    const scenario = groupScenarios.find((s) => s.variant === variant);
    if (scenario && scenario.id !== selectedScenarioId) onSelectScenario(scenario.id);
  };
  const onStepFrame = () => {
    setTimelineAuto(false);
    setFrameIndex((index) => (index >= frameCount - 1 ? 0 : index + 1));
  };
  const onResetFrames = () => {
    setTimelineAuto(false);
    setFrameIndex(0);
    setLoopIteration((value) => value + 1);
  };

  return (
    <ScreenWrapper name="SettingsDesignSystemTimelineScreen" scroll="custom" safeArea>
      {/* Receive-hub-style header: full-bleed top-level method tabs, then the
          scenario pill row — hairline separators on each band. */}
      <View style={[styles.tabBand, { borderBottomColor: separator }]}>
        <UnderlineTabs
          tabs={groups}
          selectedTab={selectedScenario.group}
          handleTabPress={onSelectGroup}
        />
      </View>
      <View style={[styles.pillBand, { borderBottomColor: separator }]}>
        <PillTabs
          tabs={variants}
          activeTab={selectedScenario.variant}
          onTabChange={onSelectVariant}
        />
      </View>

      <ScrollView className="px-4">
        <Text size={12} className="text-foreground/60 mb-4 mt-2">
          The payment{' '}
          <Text size={12} bold className="text-foreground">
            Timeline
          </Text>{' '}
          is fully state-driven. Each scenario simulates a real payment flow, stepping the Timeline
          through its states.
        </Text>

        {/* Cancel the ScrollView's px-4 so the Timeline's own 16px margin aligns with the cards. */}
        <View style={{ marginHorizontal: -16 }}>
          <HistoryEntryTimeline
            key={`${selectedScenarioId}:${loopIteration}`}
            historyEntry={currentFrame.historyEntry}
            meltQuote={currentFrame.meltQuote}
            tokenCreated={currentFrame.tokenCreated}
            nostrSent={currentFrame.nostrSent}
            onchainConfirmationProgress={currentFrame.onchainConfirmationProgress}
            onchainSettledInternally={currentFrame.onchainSettledInternally}
          />
        </View>

        <Card variant="secondary" className="mb-4 mt-3">
          <Card.Body className="gap-4 py-6">
            <VStack align="center" spacing={2}>
              <Text size={11} bold className="text-foreground/50 tracking-widest">
                {selectedScenario.label.toUpperCase()}
              </Text>
              <Text size={18} bold className="text-foreground">
                {currentFrame.note}
              </Text>
              <Text size={11} className="text-foreground/50">
                Step {Math.min(frameIndex, frameCount - 1) + 1}/{frameCount}
              </Text>
            </VStack>

            <View className="bg-surface-secondary/40 mt-1 gap-1 rounded-2xl p-4">
              <Text size={11} bold className="text-foreground/50 tracking-widest">
                CODE STATE
              </Text>
              <Text size={11} className="text-foreground/50">
                {frameState.source}
              </Text>
              <Text
                size={15}
                bold
                className="text-foreground"
                style={{ fontVariant: ['tabular-nums'] }}>
                {frameState.code}
              </Text>
              <Text size={12} className="text-foreground/70">
                {frameState.meaning}
              </Text>
              {frameState.detail?.length ? (
                <VStack spacing={4} className="mt-2">
                  {frameState.detail.map((row) => (
                    <HStack key={row.label} justify="space-between" align="center">
                      <Text size={11} className="text-foreground/50">
                        {row.label}
                      </Text>
                      <Text size={11} className="text-foreground/80">
                        {row.value}
                      </Text>
                    </HStack>
                  ))}
                </VStack>
              ) : null}
            </View>

            <HStack spacing={8}>
              <View className="flex-1">
                <Button
                  variant={timelineAuto ? 'primary' : 'secondary'}
                  size="sm"
                  onPress={() => setTimelineAuto((value) => !value)}>
                  <Button.Label>{timelineAuto ? 'Pause' : 'Play'}</Button.Label>
                </Button>
              </View>
              <View className="flex-1">
                <Button variant="secondary" size="sm" onPress={onStepFrame}>
                  <Button.Label>Step</Button.Label>
                </Button>
              </View>
              <View className="flex-1">
                <Button variant="secondary" size="sm" onPress={onResetFrames}>
                  <Button.Label>Reset</Button.Label>
                </Button>
              </View>
            </HStack>
          </Card.Body>
        </Card>

        {TIMELINE_FAMILY.scenarios.map((scenario) => (
          <Section key={scenario.id} title={scenario.title}>
            <View testID={`design-system-scenario-timeline-${scenario.id}`}>
              {scenario.render()}
            </View>
          </Section>
        ))}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  tabBand: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pillBand: {
    height: PILL_TABS_HEIGHT,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
