import React, { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';

import { Button, Card } from 'heroui-native';

import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { LoadingIndicator, type Phase, type Result } from '@/shared/blocks/status';

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
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const onLockPhase = (p: Phase) => {
    setAuto(false);
    setPhase(p);
  };
  const onLockResult = (r: Result) => {
    setAuto(false);
    setResult(r);
    setPhase('done');
  };

  const displayKey = phase === 'done' ? result : phase;

  return (
    <ScreenWrapper name="SettingsDesignSystemScreen" scroll="custom" safeArea>
      <ScrollView className="px-4">
        <Text size={12} className="text-foreground/60 mb-4 mt-2">
          Live preview of the canonical{' '}
          <Text size={12} bold className="text-foreground">
            LoadingIndicator
          </Text>{' '}
          component. Auto-cycles through every variant; tap a button to lock to a specific state.
        </Text>

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
