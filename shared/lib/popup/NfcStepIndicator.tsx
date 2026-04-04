import React from 'react';
import { View } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import type { NfcPhase, NfcProgressStatus } from '@/shared/stores/runtime/nfcProgressStore';

const STEPS: { phase: NfcPhase; label: string }[] = [
  { phase: 'reading', label: 'Reading request' },
  { phase: 'selecting', label: 'Selecting method' },
  { phase: 'creating', label: 'Creating token' },
  { phase: 'writing', label: 'Writing to tag' },
];

const PHASE_ORDER: Record<NfcPhase, number> = {
  reading: 0,
  selecting: 1,
  creating: 2,
  writing: 3,
};

type StepState = 'completed' | 'active' | 'upcoming';

function getStepState(
  stepPhase: NfcPhase,
  currentPhase: NfcPhase,
  status: NfcProgressStatus
): StepState {
  const stepIndex = PHASE_ORDER[stepPhase];
  const currentIndex = PHASE_ORDER[currentPhase];

  if (status === 'confirmed') return 'completed';
  if (status === 'failed') {
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'active';
    return 'upcoming';
  }
  if (stepIndex < currentIndex) return 'completed';
  if (stepIndex === currentIndex) return 'active';
  return 'upcoming';
}

function StepDot({ state, index }: { state: StepState; index: number }): React.ReactElement {
  const size = 18;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: state === 'upcoming' ? 'transparent' : undefined,
        borderWidth: state === 'upcoming' ? 1.5 : 0,
        borderColor: state === 'upcoming' ? 'rgba(128,128,128,0.3)' : undefined,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      className={
        state === 'completed' ? 'bg-success' : state === 'active' ? 'bg-foreground' : undefined
      }>
      {state === 'completed' && (
        <Text size={10} style={{ color: 'white' }}>
          {'✓'}
        </Text>
      )}
      {state === 'active' && (
        <Text size={9} style={{ color: 'white' }}>
          {String(index + 1)}
        </Text>
      )}
      {state === 'upcoming' && (
        <Text size={9} style={{ opacity: 0.3 }}>
          {String(index + 1)}
        </Text>
      )}
    </View>
  );
}

export function NfcStepIndicator({
  phase,
  status,
}: {
  phase: NfcPhase;
  status: NfcProgressStatus;
}): React.ReactElement {
  return (
    <View style={{ gap: 8, paddingTop: 4, alignItems: 'flex-start', alignSelf: 'center' }}>
      {STEPS.map((step, index) => {
        const state = getStepState(step.phase, phase, status);
        return (
          <View key={step.phase} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <StepDot state={state} index={index} />
            <Text
              size={13}
              weight={state === 'active' ? 'medium' : 'regular'}
              style={{
                opacity: state === 'upcoming' ? 0.4 : state === 'completed' ? 0.6 : 1,
              }}>
              {step.label}
              {state === 'active' && status === 'pending' ? '...' : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
