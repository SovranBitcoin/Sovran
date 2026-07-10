import React from 'react';

import {
  LoadingIndicator,
  mapCheckpointStatusToIndicator,
  type CheckpointStatus,
} from '@/shared/blocks/status';
import { TransferStepChain } from '@/shared/blocks/transfer/TransferStepChain';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

import type { DesignSystemScenario } from './catalog';

const LOADING_INDICATOR_SOURCE = 'shared/blocks/status/LoadingIndicator.tsx';
const TRANSFER_STEP_CHAIN_SOURCE = 'shared/blocks/transfer/TransferStepChain.tsx';

export const SEGMENT_COUNT_OPTIONS = [2, 3, 4, 5, 6, 10, 16, 24] as const;

const CHECKPOINT_STATUSES: readonly CheckpointStatus[] = [
  'future',
  'future-small',
  'next-pending',
  'current',
  'waiting',
  'complete',
  'success',
  'failed',
  'rolled-back',
  'already-spent',
];

const SEGMENT_CASES = [
  { id: 'segments-empty', title: 'Segments · 0/6', completedSegments: 0, segmentCount: 6 },
  { id: 'segments-progress', title: 'Segments · 2/6', completedSegments: 2, segmentCount: 6 },
  { id: 'segments-dense', title: 'Segments · 17/24', completedSegments: 17, segmentCount: 24 },
  { id: 'segments-complete', title: 'Segments · 6/6', completedSegments: 6, segmentCount: 6 },
] as const;

const TRANSFER_CASES = [
  { id: 'transfer-pending', title: 'Transfer · Pending', status: 'pending' },
  { id: 'transfer-invoice', title: 'Transfer · Creating invoice', status: 'creatingInvoice' },
  { id: 'transfer-routing', title: 'Transfer · Routing', status: 'routing' },
  { id: 'transfer-success', title: 'Transfer · Success', status: 'done' },
  { id: 'transfer-failure', title: 'Transfer · Failure', status: 'failed' },
  { id: 'transfer-skipped', title: 'Transfer · Skipped', status: 'skipped' },
] as const;

function SegmentedPreview({
  completedSegments,
  segmentCount,
}: {
  completedSegments: number;
  segmentCount: number;
}) {
  const complete = completedSegments >= segmentCount;
  const segmentedProgress = React.useMemo(
    () => ({ completedSegments, segmentCount }),
    [completedSegments, segmentCount]
  );

  return (
    <View className="items-center justify-center py-3">
      <LoadingIndicator
        size={96}
        phase={complete ? 'done' : 'loading'}
        result="success"
        segmentedProgress={segmentedProgress}
        segmentedInProgress={false}
        visualDisabled
      />
      <Text size={12} bold className="text-foreground/60 mt-2">
        {completedSegments}/{segmentCount} complete
      </Text>
    </View>
  );
}

function CheckpointStatusMatrix() {
  return (
    <VStack gap={8}>
      {CHECKPOINT_STATUSES.map((status) => (
        <HStack key={status} gap={10} align="center">
          <LoadingIndicator size={24} {...mapCheckpointStatusToIndicator(status)} visualDisabled />
          <Text size={12} bold>
            {status}
          </Text>
          <Text size={11} className="text-foreground/50">
            {mapCheckpointStatusToIndicator(status).phase}/
            {mapCheckpointStatusToIndicator(status).result}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}

export const SEGMENTED_PROGRESS_SCENARIOS = [
  ...SEGMENT_CASES.map(({ id, title, completedSegments, segmentCount }) => ({
    id,
    title,
    covers: [LOADING_INDICATOR_SOURCE],
    render: () => (
      <SegmentedPreview completedSegments={completedSegments} segmentCount={segmentCount} />
    ),
  })),
  {
    id: 'checkpoint-status-matrix',
    title: 'Checkpoint status matrix',
    covers: [LOADING_INDICATOR_SOURCE],
    render: () => <CheckpointStatusMatrix />,
  },
  ...TRANSFER_CASES.map(({ id, title, status }) => ({
    id,
    title,
    covers: [LOADING_INDICATOR_SOURCE, TRANSFER_STEP_CHAIN_SOURCE],
    render: () => (
      <TransferStepChain
        status={status}
        middleLabel="Route"
        routingDetail={status === 'routing' ? 'Finding a reliable path' : undefined}
      />
    ),
  })),
] satisfies readonly DesignSystemScenario[];
