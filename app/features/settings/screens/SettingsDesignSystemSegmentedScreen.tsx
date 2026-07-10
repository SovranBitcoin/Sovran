import React, { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';

import { Button, Card } from 'heroui-native';

import { getDesignSystemFamily } from '@/features/settings/design-system/catalog';
import { SEGMENT_COUNT_OPTIONS } from '@/features/settings/design-system/segmentedProgress';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { LoadingIndicator, type Phase } from '@/shared/blocks/status';

const SEGMENT_STEP_DURATION_MS = 850;
const SEGMENT_COMPLETE_HOLD_STEPS = 2;
const SEGMENTED_PROGRESS_FAMILY = getDesignSystemFamily('segmented-progress');
const CONTENT_CONTAINER_STYLE = { paddingBottom: 32 };

export function SettingsDesignSystemSegmentedScreen() {
  const surfaceSecondary = useThemeColor('surface-secondary');

  const [segmentCount, setSegmentCount] = useState<(typeof SEGMENT_COUNT_OPTIONS)[number]>(6);
  const [completedSegments, setCompletedSegments] = useState(0);
  const [segmentsAuto, setSegmentsAuto] = useState(true);
  const segmentCycleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentCompleteHoldRef = useRef(0);

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

  const visibleCompletedSegments = Math.min(completedSegments, segmentCount);
  const segmentedPhase: Phase = visibleCompletedSegments >= segmentCount ? 'done' : 'loading';

  return (
    <ScreenWrapper name="SettingsDesignSystemSegmentedScreen" scroll="custom" safeArea>
      <ScrollView className="px-4" contentContainerStyle={CONTENT_CONTAINER_STYLE}>
        <Text size={12} className="text-foreground/60 mb-4 mt-2">
          The{' '}
          <Text size={12} bold className="text-foreground">
            LoadingIndicator
          </Text>{' '}
          in segmented mode — discrete progress where each completed step fills one segment of the
          ring. Pick a segment count, or step through manually.
        </Text>

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

        {SEGMENTED_PROGRESS_FAMILY.scenarios.map((scenario) => (
          <Section key={scenario.id} title={scenario.title}>
            <View testID={`design-system-scenario-segmented-progress-${scenario.id}`}>
              {scenario.render()}
            </View>
          </Section>
        ))}
      </ScrollView>
    </ScreenWrapper>
  );
}
