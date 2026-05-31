import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView } from 'react-native';

import { Button, Card } from 'heroui-native';

import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { LoadingIndicator, type Phase, type Result } from '@/shared/blocks/status';
import { HistoryEntryTimeline } from '@/features/transactions';

import { buildTimelineScenarios } from './designSystemTimelineScenarios';

type CycleStep = { type: 'phase'; value: Phase } | { type: 'result'; value: Result };

const CYCLE: CycleStep[] = [
  { type: 'phase', value: 'idle' },
  { type: 'phase', value: 'loading' },
  { type: 'result', value: 'success' },
  { type: 'phase', value: 'idle' },
  { type: 'phase', value: 'loading' },
  { type: 'result', value: 'error' },
  { type: 'phase', value: 'idle' },
  { type: 'phase', value: 'loading' },
  { type: 'result', value: 'reverted' },
];

const STEP_DURATION_MS = 1700;
const SEGMENT_STEP_DURATION_MS = 850;
const SEGMENT_COMPLETE_HOLD_STEPS = 2;
const SEGMENT_COUNT_OPTIONS = [2, 3, 4, 5, 6, 10, 16, 24] as const;
const TIMELINE_FRAME_DURATION_MS = 1500;
const TIMELINE_COMPLETE_HOLD_STEPS = 2;

const STATE_LABEL: Record<string, string> = {
  idle: 'Idle',
  loading: 'Loading',
  success: 'Resolved · Success',
  error: 'Resolved · Error',
  reverted: 'Resolved · Reverted',
};

export function SettingsDesignSystemScreen() {
  const surfaceSecondary = useThemeColor('surface-secondary');

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<Result>('success');
  const [auto, setAuto] = useState(true);
  const [segmentCount, setSegmentCount] = useState<(typeof SEGMENT_COUNT_OPTIONS)[number]>(6);
  const [completedSegments, setCompletedSegments] = useState(0);
  const [segmentsAuto, setSegmentsAuto] = useState(true);
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentCycleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentCompleteHoldRef = useRef(0);

  // Timeline showcase — fixed createdAt so the simulated timestamps don't churn on re-render.
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

  useEffect(() => {
    if (!auto) {
      if (cycleRef.current) clearInterval(cycleRef.current);
      cycleRef.current = null;
      return;
    }

    let i = 0;
    const apply = (s: CycleStep) => {
      if (s.type === 'phase') {
        setPhase(s.value);
      } else {
        setResult(s.value);
        setPhase('done');
      }
    };
    apply(CYCLE[0]);
    i = 1;
    cycleRef.current = setInterval(() => {
      apply(CYCLE[i]);
      i = (i + 1) % CYCLE.length;
    }, STEP_DURATION_MS);

    return () => {
      if (cycleRef.current) clearInterval(cycleRef.current);
      cycleRef.current = null;
    };
  }, [auto]);

  useEffect(() => {
    if (!segmentsAuto) {
      if (segmentCycleRef.current) clearInterval(segmentCycleRef.current);
      segmentCycleRef.current = null;
      return;
    }

    segmentCompleteHoldRef.current = 0;
    segmentCycleRef.current = setInterval(() => {
      setCompletedSegments((value) => {
        if (value >= segmentCount) {
          if (segmentCompleteHoldRef.current < SEGMENT_COMPLETE_HOLD_STEPS) {
            segmentCompleteHoldRef.current += 1;
            return value;
          }

          segmentCompleteHoldRef.current = 0;
          return 0;
        }

        segmentCompleteHoldRef.current = 0;
        return value + 1;
      });
    }, SEGMENT_STEP_DURATION_MS);

    return () => {
      if (segmentCycleRef.current) clearInterval(segmentCycleRef.current);
      segmentCycleRef.current = null;
    };
  }, [segmentCount, segmentsAuto]);

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

  const onLockPhase = (p: Phase) => {
    setAuto(false);
    setPhase(p);
  };
  const onLockResult = (r: Result) => {
    setAuto(false);
    setResult(r);
    setPhase('done');
  };
  const onSelectSegmentCount = (count: (typeof SEGMENT_COUNT_OPTIONS)[number]) => {
    setSegmentCount(count);
    setCompletedSegments(0);
    setSegmentsAuto(true);
  };
  const onStepSegment = () => {
    setSegmentsAuto(false);
    setCompletedSegments((value) => (value >= segmentCount ? 0 : value + 1));
  };
  const onResetSegments = () => {
    setSegmentsAuto(false);
    setCompletedSegments(0);
  };

  const displayKey = phase === 'done' ? result : phase;
  const visibleCompletedSegments = Math.min(completedSegments, segmentCount);
  const segmentedPhase: Phase = visibleCompletedSegments >= segmentCount ? 'done' : 'loading';

  return (
    <ScreenWrapper name="SettingsDesignSystemScreen" scroll="custom" safeArea>
      <ScrollView className="px-4">
        <Text size={12} className="text-foreground/60 mb-4 mt-2">
          Live preview of the canonical{' '}
          <Text size={12} bold className="text-foreground">
            LoadingIndicator
          </Text>{' '}
          and payment{' '}
          <Text size={12} bold className="text-foreground">
            Timeline
          </Text>{' '}
          components. They auto-cycle through every variant; tap a button to lock or pick a flow.
        </Text>

        <Text size={11} bold className="text-foreground/50 mb-2 tracking-widest">
          TIMELINE
        </Text>
        <Text size={12} className="text-foreground/60 mb-3">
          Each scenario simulates a real payment flow, stepping the Timeline through its states.
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

        <Card variant="secondary" className="mb-4">
          <Card.Body className="gap-4 py-6">
            <View
              className="items-center justify-center self-center rounded-full"
              style={{
                width: 200,
                height: 200,
                backgroundColor: surfaceSecondary,
              }}>
              <LoadingIndicator size={140} phase={phase} result={result} />
            </View>
            <VStack align="center" spacing={2}>
              <Text size={11} bold className="text-foreground/50 tracking-widest">
                CURRENT STATE
              </Text>
              <Text size={18} bold className="text-foreground">
                {STATE_LABEL[displayKey] ?? displayKey}
              </Text>
            </VStack>
          </Card.Body>
        </Card>

        <Card variant="secondary" className="mb-4">
          <Card.Body className="gap-4 py-6">
            <View
              className="items-center justify-center self-center rounded-full"
              style={{
                width: 168,
                height: 168,
                backgroundColor: surfaceSecondary,
              }}>
              <LoadingIndicator
                size={118}
                phase={segmentedPhase}
                result="success"
                segmentedProgress={{
                  completedSegments: visibleCompletedSegments,
                  segmentCount,
                }}
              />
            </View>
            <VStack align="center" spacing={2}>
              <Text size={11} bold className="text-foreground/50 tracking-widest">
                SEGMENTED
              </Text>
              <Text size={18} bold className="text-foreground">
                {visibleCompletedSegments}/{segmentCount} Complete
              </Text>
            </VStack>

            <Text size={11} bold className="text-foreground/50 mt-2 tracking-widest">
              SEGMENTS
            </Text>
            <HStack gap={8} wrap="wrap">
              {SEGMENT_COUNT_OPTIONS.map((count) => (
                <View key={count} style={{ width: 58 }}>
                  <Button
                    variant={segmentCount === count ? 'primary' : 'secondary'}
                    size="sm"
                    onPress={() => onSelectSegmentCount(count)}>
                    <Button.Label>{count}</Button.Label>
                  </Button>
                </View>
              ))}
            </HStack>

            <HStack spacing={8}>
              <View className="flex-1">
                <Button
                  variant={segmentsAuto ? 'primary' : 'secondary'}
                  size="sm"
                  onPress={() => setSegmentsAuto((value) => !value)}>
                  <Button.Label>{segmentsAuto ? 'Pause' : 'Play'}</Button.Label>
                </Button>
              </View>
              <View className="flex-1">
                <Button variant="secondary" size="sm" onPress={onStepSegment}>
                  <Button.Label>Step</Button.Label>
                </Button>
              </View>
              <View className="flex-1">
                <Button variant="secondary" size="sm" onPress={onResetSegments}>
                  <Button.Label>Reset</Button.Label>
                </Button>
              </View>
            </HStack>
          </Card.Body>
        </Card>

        <Card variant="secondary" className="mb-4">
          <Card.Body className="gap-4">
            <Text size={11} bold className="text-foreground/50 tracking-widest">
              PHASE
            </Text>
            <HStack spacing={8}>
              <View className="flex-1">
                <Button
                  variant={!auto && phase === 'idle' ? 'primary' : 'secondary'}
                  size="sm"
                  onPress={() => onLockPhase('idle')}>
                  <Button.Label>Idle</Button.Label>
                </Button>
              </View>
              <View className="flex-1">
                <Button
                  variant={!auto && phase === 'loading' ? 'primary' : 'secondary'}
                  size="sm"
                  onPress={() => onLockPhase('loading')}>
                  <Button.Label>Loading</Button.Label>
                </Button>
              </View>
            </HStack>

            <Text size={11} bold className="text-foreground/50 mt-2 tracking-widest">
              RESOLVE TO
            </Text>
            <VStack spacing={8}>
              <Button
                variant={
                  !auto && phase === 'done' && result === 'success' ? 'primary' : 'secondary'
                }
                size="sm"
                onPress={() => onLockResult('success')}>
                <Button.Label>Success</Button.Label>
              </Button>
              <Button
                variant={!auto && phase === 'done' && result === 'error' ? 'primary' : 'secondary'}
                size="sm"
                onPress={() => onLockResult('error')}>
                <Button.Label>Error</Button.Label>
              </Button>
              <Button
                variant={
                  !auto && phase === 'done' && result === 'reverted' ? 'primary' : 'secondary'
                }
                size="sm"
                onPress={() => onLockResult('reverted')}>
                <Button.Label>Reverted</Button.Label>
              </Button>
            </VStack>

            <Button
              variant={auto ? 'primary' : 'secondary'}
              size="sm"
              onPress={() => setAuto((v) => !v)}>
              <Button.Label>{auto ? 'Stop auto-cycle' : 'Start auto-cycle'}</Button.Label>
            </Button>
          </Card.Body>
        </Card>

        <Card variant="secondary" className="mb-4">
          <Card.Body className="gap-3">
            <Text size={11} bold className="text-foreground/50 tracking-widest">
              SIZES
            </Text>
            <Text size={12} className="text-foreground/60">
              The same component at different render sizes.
            </Text>
            <HStack gap={16} wrap="wrap" align="flex-end" justify="space-around" className="py-4">
              {[16, 20, 32, 48, 72].map((size) => (
                <VStack key={size} align="center" spacing={6}>
                  <LoadingIndicator size={size} phase={phase} result={result} />
                  <Text size={10} className="text-foreground/50">
                    {size}px
                  </Text>
                </VStack>
              ))}
            </HStack>
          </Card.Body>
        </Card>
      </ScrollView>
    </ScreenWrapper>
  );
}
