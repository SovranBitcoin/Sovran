import React from 'react';

import { HistoryEntryTimeline } from '@/features/transactions/components/detail/timeline';
import { buildTimelineScenarios } from '@/features/settings/screens/designSystemTimelineScenarios';

import type { DesignSystemScenario } from './catalog';

const TIMELINE_CARD_SOURCE = 'features/transactions/components/detail/timeline/TimelineCard.tsx';
const TIMELINE_ROW_SOURCE = 'features/transactions/components/detail/timeline/TimelineRow.tsx';
const LOADING_INDICATOR_SOURCE = 'shared/blocks/status/LoadingIndicator.tsx';
const GRADIENT_CARD_SOURCE = 'shared/ui/composed/GradientCard.tsx';
const BLUR_CARD_FRAME_SOURCE = 'shared/ui/composed/BlurCardFrame.tsx';

const DESIGN_SYSTEM_TIMELINE_CREATED_AT = Date.UTC(2026, 4, 22, 12, 0, 0);

const TIMELINE_CASES = [
  {
    id: 'cashu-send-pending',
    title: 'Cashu send · Pending',
    sourceId: 'ecash-send',
    frame: 1,
  },
  {
    id: 'cashu-send-success',
    title: 'Cashu send · Success',
    sourceId: 'ecash-send',
    frame: 'last',
  },
  {
    id: 'cashu-send-rolled-back',
    title: 'Cashu send · Rolled back',
    sourceId: 'send-rolled-back',
    frame: 'last',
  },
  {
    id: 'cashu-receive-already-spent',
    title: 'Cashu receive · Already spent',
    sourceId: 'receive-already-spent',
    frame: 'last',
  },
  {
    id: 'lightning-receive-waiting',
    title: 'Lightning receive · Waiting',
    sourceId: 'ln-receive',
    frame: 0,
  },
  {
    id: 'lightning-mint-failed',
    title: 'Lightning receive · Failed',
    sourceId: 'mint-failed',
    frame: 'last',
  },
  {
    id: 'onchain-send-mempool',
    title: 'Onchain send · In mempool',
    sourceId: 'onchain-send',
    frame: 2,
  },
  {
    id: 'onchain-send-confirmed',
    title: 'Onchain send · Confirmed',
    sourceId: 'onchain-send',
    frame: 'last',
  },
  {
    id: 'payment-request-delivered',
    title: 'Payment request · Delivered',
    sourceId: 'payment-request',
    frame: 3,
  },
] as const;

function frameFor(sourceId: string, index: number | 'last') {
  const scenario = buildTimelineScenarios(DESIGN_SYSTEM_TIMELINE_CREATED_AT).find(
    (candidate) => candidate.id === sourceId
  );
  if (!scenario) throw new Error(`Unknown timeline scenario: ${sourceId}`);

  const frame =
    index === 'last' ? scenario.frames[scenario.frames.length - 1] : scenario.frames[index];
  if (!frame) throw new Error(`Unknown timeline frame: ${sourceId}/${String(index)}`);
  return frame;
}

function TimelineScenarioPreview({
  sourceId,
  index,
}: {
  sourceId: string;
  index: number | 'last';
}) {
  const frame = React.useMemo(() => frameFor(sourceId, index), [index, sourceId]);

  return (
    <HistoryEntryTimeline
      historyEntry={frame.historyEntry}
      meltQuote={frame.meltQuote}
      tokenCreated={frame.tokenCreated}
      nostrSent={frame.nostrSent}
      onchainConfirmationProgress={frame.onchainConfirmationProgress}
      onchainSettledInternally={frame.onchainSettledInternally}
    />
  );
}

export const TIMELINE_SCENARIOS = TIMELINE_CASES.map(({ id, title, sourceId, frame: index }) => {
  return {
    id,
    title,
    covers: [
      TIMELINE_CARD_SOURCE,
      TIMELINE_ROW_SOURCE,
      LOADING_INDICATOR_SOURCE,
      GRADIENT_CARD_SOURCE,
      BLUR_CARD_FRAME_SOURCE,
    ],
    render: () => <TimelineScenarioPreview sourceId={sourceId} index={index} />,
  };
}) satisfies readonly DesignSystemScenario[];
