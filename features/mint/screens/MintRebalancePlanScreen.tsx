import { useState, useEffect, useMemo, useCallback } from 'react';
import { Stack } from 'expo-router';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import opacity from 'hex-color-opacity';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { z } from 'zod';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Screen } from '@/shared/ui/composed/Screen';
import { useMints, useBalanceContext } from '@cashu/coco-react';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { useMintManagement } from '@/features/mint/hooks/useMintManagement';
import { amountToNumber } from '@/shared/lib/cashu/amount';

import {
  EMPTY_DISTRIBUTION,
  useMintDistributionStore,
} from '@/shared/stores/profile/mintDistributionStore';
import {
  RebalanceStepRow,
  RebalanceChainCard,
  groupStepsForDisplay,
  computeRebalancePlan,
  isAlreadyBalanced,
} from '@/features/mint/components/rebalance';
import {
  PENDING_STEP_STATE,
  computeRebalanceStepCounts,
} from '@/features/mint/lib/rebalanceRunState';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useLifecycleLogger } from '@/shared/lib/logger';
import { useMintRebalanceOrchestrator } from '@/features/mint/hooks/useMintRebalanceOrchestrator';
import { LoadingIndicator } from '@/shared/blocks/status';

const ParamsSchema = z.object({
  unit: z.string().max(16).optional(),
});

export function MintRebalancePlanScreen() {
  useLifecycleLogger('MintRebalancePlanScreen');
  const [foreground, surfaceTertiary, surfaceSecondary, background] = useThemeColor([
    'foreground',
    'surface-tertiary',
    'surface-secondary',
    'background',
  ] as const);
  const [danger, green400] = useThemeColor(['danger', 'green-400'] as const);
  const fgMuted = opacity(foreground, 0.5);
  const fgDim = opacity(foreground, 0.4);

  const params = useRouteParams(ParamsSchema, { where: 'mint-flow.rebalancePlan' });
  const unit = params?.unit?.toLowerCase() || 'sat';

  const { trustedMints } = useMints();
  const { balances: liveBalanceCtx } = useBalanceContext();
  const liveBalances = liveBalanceCtx.byMint;
  const { getMintInfo } = useMintManagement();
  const middlemanRouting = useSettingsStore((state) => state.middlemanRouting);
  const minTransferThreshold = useSettingsStore((state) => state.minTransferThreshold);
  const [mintInfoMap, setMintInfoMap] = useState<Record<string, GetInfoResponse | null>>({});

  // Narrow the selector to the per-unit slice. Returning the whole `distributions`
  // record made any write to any unit re-render this screen even though only the
  // active unit's slice is read. Falling back to a shared frozen empty object keeps
  // the reference stable when the unit has no entry yet.
  const distribution = useMintDistributionStore(
    (state) => state.distributions[unit] ?? EMPTY_DISTRIBUTION
  );

  const mintsForUnit = useMemo(() => {
    return trustedMints.filter((mint) => {
      if (unit === 'sat') {
        if (!mint.mintInfo?.nuts?.['4']?.methods) return true;
        return mint.mintInfo.nuts['4'].methods.some(
          (method) => method.unit?.toLowerCase() === 'sat'
        );
      }
      if (!mint.mintInfo?.nuts?.['4']?.methods) return false;
      return mint.mintInfo.nuts['4'].methods.some((method) => method.unit?.toLowerCase() === unit);
    });
  }, [trustedMints, unit]);

  const mintUrls = useMemo(() => mintsForUnit.map((m) => m.mintUrl), [mintsForUnit]);

  useEffect(() => {
    let cancelled = false;
    const loadMintInfo = async () => {
      const results = await Promise.allSettled(
        trustedMints.map((mint) =>
          getMintInfo(mint.mintUrl).then(
            (info) => [mint.mintUrl, info] as const,
            () => [mint.mintUrl, mint.mintInfo || null] as const
          )
        )
      );
      if (cancelled) return;
      const infoMap: Record<string, GetInfoResponse | null> = {};
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const [url, info] = r.value;
          infoMap[url] = info;
        }
      }
      setMintInfoMap(infoMap);
    };
    void loadMintInfo();
    return () => {
      cancelled = true;
    };
  }, [trustedMints, getMintInfo]);

  const computedPlan = useMemo(() => {
    const mintBalances = mintUrls.map((mintUrl) => ({
      mintUrl,
      balance: amountToNumber(liveBalances[mintUrl]?.total),
    }));
    return computeRebalancePlan(mintBalances, distribution, minTransferThreshold);
  }, [mintUrls, liveBalances, distribution, minTransferThreshold]);

  const {
    plan,
    runPlan,
    stepStates,
    runStatus,
    swapGroupId,
    handleStart,
    handleRetry,
    handleSkip,
    handleRetryFailed,
    handleRouteThrough,
    handleCancelRun,
  } = useMintRebalanceOrchestrator({
    unit,
    computedPlan,
    trustedMints,
    mintInfoMap,
    middlemanRouting,
    minTransferThreshold,
  });

  const alreadyBalanced = useMemo(() => {
    return isAlreadyBalanced(plan.currentBalances, plan.targetBalances, minTransferThreshold);
  }, [plan, minTransferThreshold]);

  const stepCounts = useMemo(
    () => computeRebalanceStepCounts(plan.steps, stepStates, !!runPlan),
    [plan.steps, stepStates, runPlan]
  );

  const handleDone = useCallback(() => {
    router.dismissTo('/');
  }, []);

  const bottomButtons = useMemo(() => {
    if (alreadyBalanced || plan.steps.length === 0) {
      return (
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                text: 'Done',
                variant: 'primary' as const,
                onPress: async () => handleDone(),
              },
            ]}
          />
        </BottomButtons>
      );
    }

    if (runStatus === 'finished' || stepCounts.allComplete) {
      return (
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                text: 'Done',
                variant: 'primary' as const,
                onPress: async () => handleDone(),
              },
              ...(stepCounts.hasFailedStep
                ? [
                    {
                      text: 'Retry failed',
                      variant: 'secondary' as const,
                      onPress: async () => handleRetryFailed(),
                    },
                  ]
                : []),
            ]}
          />
        </BottomButtons>
      );
    }

    if (runStatus === 'idle') {
      return (
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                text: 'Cancel',
                variant: 'secondary' as const,
                onPress: async () => handleDone(),
              },
              {
                text: 'Start rebalancing',
                variant: 'primary' as const,
                onPress: async () => handleStart(),
              },
            ]}
          />
        </BottomButtons>
      );
    }

    return (
      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: runStatus === 'cancelled' ? 'Done' : 'Stop',
              variant: 'secondary' as const,
              onPress: async () => {
                if (runStatus === 'cancelled') return handleDone();
                if (runStatus === 'running') return handleCancelRun();
                return handleDone();
              },
              disabled: stepCounts.executing && runStatus === 'running',
            },
          ]}
        />
      </BottomButtons>
    );
  }, [
    alreadyBalanced,
    plan.steps,
    stepCounts,
    runStatus,
    handleDone,
    handleStart,
    handleRetryFailed,
    handleCancelRun,
  ]);

  return (
    <Screen
      name="MintRebalancePlanScreen"
      footer={bottomButtons}
      contentPadding={0}
      bgColor={background}>
      <Stack.Screen
        options={{
          title: 'Rebalance plan',
          headerRight: () => null,
        }}
      />

      <View className="mx-4 my-2 rounded-2xl p-4" style={{ backgroundColor: surfaceSecondary }}>
        <VStack gap={8}>
          {runPlan && (
            <View
              className="h-1.5 overflow-hidden rounded-full"
              style={{ backgroundColor: surfaceTertiary }}>
              <View
                className="h-1.5 rounded-full"
                style={{
                  width: `${stepCounts.progressPct * 100}%`,
                  backgroundColor: stepCounts.failed > 0 ? danger : green400,
                }}
              />
            </View>
          )}
          <HStack justify="space-between" align="center">
            <Text size={14} style={{ color: fgMuted }}>
              Total to move
            </Text>
            <AmountFormatter
              amount={plan.totalAmount}
              unit={unit}
              size={18}
              weight="heavy"
              color={foreground}
            />
          </HStack>
          <HStack justify="space-between" align="center">
            <Text size={14} style={{ color: fgMuted }}>
              Steps
            </Text>
            <Text bold size={18} style={{ color: foreground }}>
              {stepCounts.completed}/{plan.steps.length}
            </Text>
          </HStack>
          {runPlan && stepCounts.skipped > 0 && (
            <HStack justify="space-between" align="center">
              <Text size={14} style={{ color: fgMuted }}>
                Skipped
              </Text>
              <Text bold size={18} style={{ color: fgDim }}>
                {stepCounts.skipped}
              </Text>
            </HStack>
          )}
          {runPlan && (
            <HStack justify="space-between" align="center">
              <Text size={14} style={{ color: fgMuted }}>
                Errors
              </Text>
              <Text bold size={18} style={{ color: stepCounts.failed > 0 ? danger : foreground }}>
                {stepCounts.failed}
              </Text>
            </HStack>
          )}
          <Text size={11} style={{ color: fgDim }}>
            Transfers under {minTransferThreshold} sats are ignored
          </Text>
        </VStack>
      </View>

      {alreadyBalanced && (
        <View className="items-center p-10">
          <VStack gap={12} align="center">
            <LoadingIndicator
              size={48}
              phase="done"
              result="success"
              successColor={green400}
              playOnMount
            />
            <Text size={16} style={{ color: foreground, textAlign: 'center' }}>
              Already balanced!
            </Text>
            <Text size={14} style={{ color: fgMuted, textAlign: 'center' }}>
              Your current balances match the desired distribution.
            </Text>
          </VStack>
        </View>
      )}

      {!alreadyBalanced && plan.steps.length === 0 && (
        <View className="items-center p-10">
          <VStack gap={12} align="center">
            <LoadingIndicator
              size={48}
              phase="done"
              result="success"
              successColor={green400}
              playOnMount
            />
            <Text size={16} style={{ color: foreground, textAlign: 'center' }}>
              No transfers needed
            </Text>
            <Text size={14} style={{ color: fgMuted, textAlign: 'center' }}>
              All differences are below the {minTransferThreshold} sat threshold.
            </Text>
          </VStack>
        </View>
      )}

      {plan.steps.length > 0 && (
        <Animated.View layout={LinearTransition.duration(280)}>
          <VStack gap={0} className="pt-2">
            {groupStepsForDisplay(plan.steps, runPlan ? stepStates : {}).map((group) => {
              if (group.chainId && group.steps.length > 1) {
                return (
                  <RebalanceChainCard
                    key={group.id}
                    group={group}
                    stepStates={runPlan ? stepStates : {}}
                    mintInfoMap={mintInfoMap}
                    unit={unit}
                    isRunning={runStatus === 'running'}
                    onRetry={handleRetry}
                    onSkip={handleSkip}
                  />
                );
              }

              const step = group.steps[0];
              const state = runPlan
                ? stepStates[step.id] || PENDING_STEP_STATE
                : PENDING_STEP_STATE;
              return (
                <RebalanceStepRow
                  key={step.id}
                  id={step.id}
                  fromMintUrl={step.fromMintUrl}
                  fromMintInfo={mintInfoMap[step.fromMintUrl]}
                  toMintUrl={step.toMintUrl}
                  toMintInfo={mintInfoMap[step.toMintUrl]}
                  amount={step.amount}
                  unit={unit}
                  status={state.status}
                  errorMessage={state.errorMessage}
                  routeSuggestion={state.routeSuggestion}
                  routingDetail={state.routingDetail}
                  onRouteThrough={
                    runStatus !== 'running' ? () => handleRouteThrough(step) : undefined
                  }
                  onRetry={
                    runStatus !== 'running' &&
                    state.status === 'failed' &&
                    !String(state.errorMessage ?? '').startsWith('Payment pending.')
                      ? () => handleRetry(step)
                      : undefined
                  }
                  onSkip={runStatus !== 'running' ? () => handleSkip(step) : undefined}
                  chainInfo={
                    step.chainId && step.chainPath
                      ? {
                          chainId: step.chainId,
                          chainPath: step.chainPath,
                          chainHopIndex: step.chainHopIndex ?? 0,
                          pathMintInfos: step.chainPath.map((url) => mintInfoMap[url] ?? null),
                        }
                      : undefined
                  }
                />
              );
            })}
          </VStack>
        </Animated.View>
      )}

      {runStatus === 'finished' && plan.steps.length > 0 && swapGroupId && (
        <View className="px-4 pb-2 pt-3">
          <Pressable
            haptics
            onPress={() => {
              router.navigate({
                pathname: '/swap',
                params: { groupId: swapGroupId },
              });
            }}>
            <View
              className="overflow-hidden rounded-[20px] border"
              style={{ borderColor: surfaceTertiary, borderCurve: 'continuous' as any }}>
              <BlurCardFrame accentColor={fgMuted}>
                <View className="z-[1] items-center p-3">
                  <Text size={14} bold style={{ color: foreground }}>
                    View Swap
                  </Text>
                </View>
              </BlurCardFrame>
            </View>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}
