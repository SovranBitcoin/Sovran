/**
 * @fileoverview Rebalance Chain Card
 *
 * Renders a multi-hop middleman chain inside a single TransferCard.
 * Each hop shows its full send → progress → receive sequence so the
 * user can see exactly what's happening at every stage of the chain.
 */

import React from 'react';

import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import {
  TransferCard,
  TransferEntryRow,
  TransferStepChain,
  TransferErrorBanner,
} from '@/shared/blocks/transfer';
import { RebalanceActionPill } from './RebalanceActionPill';

import { getMintDisplayName } from '@/shared/lib/url';
import { Log } from '@/shared/lib/logger';

import type { TransferStep } from './rebalancePlanner';
import type { StepStatus } from './RebalanceStepRow';
import type { StepState, StepGroup } from './groupSteps';

interface MintInfo {
  name?: string;
  icon_url?: string;
}

interface RebalanceChainCardProps {
  group: StepGroup;
  stepStates: Record<string, StepState>;
  mintInfoMap: Record<string, MintInfo | null>;
  unit: string;
  /** Whether the rebalance run is currently executing. */
  isRunning: boolean;
  onRetry?: (step: TransferStep) => void;
  onSkip?: (step: TransferStep) => void;
}

export const RebalanceChainCard: React.FC<RebalanceChainCardProps> = ({
  group,
  stepStates,
  mintInfoMap,
  unit,
  isRunning,
  onRetry,
  onSkip,
}) => {
  const { steps } = group;

  const allDone = steps.every((s) => stepStates[s.id]?.status === 'done');
  const failedStep = steps.find((s) => stepStates[s.id]?.status === 'failed');
  const failedState = failedStep ? stepStates[failedStep.id] : undefined;

  return (
    <Log name="RebalanceChainCard">
      <View className="mx-4 my-1.5" style={allDone ? { opacity: 0.85 } : undefined}>
        <TransferCard>
          {/* ── Hop rows — each hop shows send → progress → receive ── */}
          {steps.map((step) => {
            const state = stepStates[step.id] || { status: 'pending' as StepStatus };

            const fromInfo = mintInfoMap[step.fromMintUrl];
            const toInfo = mintInfoMap[step.toMintUrl];
            const fromName = getMintDisplayName(step.fromMintUrl, fromInfo);
            const toName = getMintDisplayName(step.toMintUrl, toInfo);

            const hopStatus = state.status as StepStatus;

            return (
              <React.Fragment key={step.id}>
                <TransferEntryRow
                  type="send"
                  mintIconUrl={fromInfo?.icon_url}
                  mintName={fromName}
                  amount={step.amount}
                  unit={unit}
                />

                <TransferStepChain
                  status={hopStatus}
                  routingDetail={state.routingDetail}
                  middleLabel="Send"
                />

                <TransferEntryRow
                  type="receive"
                  mintIconUrl={toInfo?.icon_url}
                  mintName={toName}
                  amount={step.amount}
                  unit={unit}
                />
              </React.Fragment>
            );
          })}

          {/* ── Error banner + actions for the first failed hop ── */}
          {failedStep && failedState?.errorMessage && (
            <VStack gap={8} className="pb-3">
              <TransferErrorBanner message={failedState.errorMessage} />

              <HStack gap={8} className="px-4">
                {!isRunning && onRetry && (
                  <RebalanceActionPill
                    icon="mdi:refresh"
                    label="Retry"
                    onPress={() => onRetry(failedStep)}
                  />
                )}
                {!isRunning && onSkip && (
                  <RebalanceActionPill
                    icon="mdi:skip-next"
                    label="Skip"
                    onPress={() => onSkip(failedStep)}
                  />
                )}
              </HStack>
            </VStack>
          )}
        </TransferCard>
      </View>
    </Log>
  );
};
