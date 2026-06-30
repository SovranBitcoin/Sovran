import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView } from 'react-native';

import { Button, Card } from 'heroui-native';

import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { HistoryEntryTimeline } from '@/features/transactions';

import { buildTimelineScenarios, describeFrameState } from './designSystemTimelineScenarios';

const TIMELINE_FRAME_DURATION_MS = 1500;
const TIMELINE_COMPLETE_HOLD_STEPS = 2;

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

  const selectedScenario =
    timelineScenarios.find((s) => s.id === selectedScenarioId) ?? timelineScenarios[0];
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

            <Text size={11} bold className="text-foreground/50 mt-2 tracking-widest">
              SCENARIO
            </Text>
            <HStack gap={8} wrap="wrap">
              {timelineScenarios.map((scenario) => (
                <Button
                  key={scenario.id}
                  variant={selectedScenarioId === scenario.id ? 'primary' : 'secondary'}
                  size="sm"
                  onPress={() => onSelectScenario(scenario.id)}>
                  <Button.Label>{scenario.label}</Button.Label>
                </Button>
              ))}
            </HStack>

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
      </ScrollView>
    </ScreenWrapper>
  );
}
