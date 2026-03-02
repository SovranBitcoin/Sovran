/**
 * @fileoverview Demo mode mock execution engine for the rebalance plan.
 *
 * Simulates the real execution flow with realistic timing and state
 * transitions, including middleman routing for configurable steps.
 * Dev-only — gated behind __DEV__ at the call site.
 *
 * State machine per step:
 *   pending → creatingInvoice → invoiceReady → melting → verifying → done
 *
 * For steps that "need middleman routing":
 *   pending → creatingInvoice → invoiceReady → melting → (no_route) → routing
 *   → original becomes skipped, chain hops are injected and each runs:
 *   pending → creatingInvoice → invoiceReady → melting → verifying → done
 */

import type { TransferStep } from './rebalancePlanner';
import type { StepState } from './groupSteps';

interface DemoConfig {
  /** Indices of original steps that should trigger middleman routing (0-based). */
  middlemanStepIndices: number[];
  /** How many intermediary mints to insert per middleman chain. Default: 1 */
  intermediaryCount?: number;
}

interface DemoCallbacks {
  updateStepState: (stepId: string, update: Partial<StepState>) => void;
  setRunPlan: React.Dispatch<
    React.SetStateAction<{
      steps: TransferStep[];
      totalAmount: number;
      currentBalances: Record<string, number>;
      targetBalances: Record<string, number>;
    } | null>
  >;
  setRunStatus: (status: 'idle' | 'running' | 'finished' | 'cancelled') => void;
  setStepStates: React.Dispatch<React.SetStateAction<Record<string, StepState>>>;
  mintUrls: string[];
  mintInfoMap: Record<string, { name?: string; icon_url?: string } | null>;
}

const DEMO_MINT_URLS = [
  'https://demo-mint-alpha.example.com',
  'https://demo-mint-beta.example.com',
  'https://demo-mint-gamma.example.com',
  'https://demo-mint-delta.example.com',
];

const DEMO_MINT_NAMES: Record<string, string> = {
  'https://demo-mint-alpha.example.com': 'Alpha Mint',
  'https://demo-mint-beta.example.com': 'Beta Mint',
  'https://demo-mint-gamma.example.com': 'Gamma Mint',
  'https://demo-mint-delta.example.com': 'Delta Mint',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pick intermediary mint URLs that aren't already the source or destination.
 * Prefers real mints from the user's wallet, falls back to demo mints.
 */
function pickIntermediaries(
  fromMintUrl: string,
  toMintUrl: string,
  availableMints: string[],
  count: number
): string[] {
  const candidates = availableMints.filter((u) => u !== fromMintUrl && u !== toMintUrl);
  const result: string[] = [];

  for (let i = 0; i < count; i++) {
    if (i < candidates.length) {
      result.push(candidates[i]);
    } else {
      // Fall back to demo mints
      const demoCandidate = DEMO_MINT_URLS.find(
        (u) => u !== fromMintUrl && u !== toMintUrl && !result.includes(u)
      );
      if (demoCandidate) result.push(demoCandidate);
    }
  }

  return result;
}

/** Simulate the step state transitions for a single hop. */
async function simulateHop(
  stepId: string,
  update: (stepId: string, s: Partial<StepState>) => void,
  abortSignal: { aborted: boolean }
): Promise<boolean> {
  const transitions: { status: StepState['status']; delay: number }[] = [
    { status: 'creatingInvoice', delay: 600 },
    { status: 'invoiceReady', delay: 400 },
    { status: 'melting', delay: 1200 },
    { status: 'verifying', delay: 800 },
    { status: 'done', delay: 0 },
  ];

  for (const { status, delay } of transitions) {
    if (abortSignal.aborted) return false;
    update(stepId, { status, errorMessage: undefined });
    if (delay > 0) await sleep(delay);
  }
  return true;
}

/**
 * Run the full demo execution against the current plan.
 * Returns an abort handle so the caller can cancel mid-run.
 */
export function runDemoExecution(
  plan: {
    steps: TransferStep[];
    totalAmount: number;
    currentBalances: Record<string, number>;
    targetBalances: Record<string, number>;
  },
  config: DemoConfig,
  callbacks: DemoCallbacks
): { abort: () => void } {
  const abortSignal = { aborted: false };
  const { middlemanStepIndices, intermediaryCount = 1 } = config;
  const { updateStepState, setRunPlan, setRunStatus, setStepStates, mintUrls, mintInfoMap } =
    callbacks;

  const middlemanSet = new Set(middlemanStepIndices);

  // Clone steps so we can mutate the plan
  let currentSteps = [...plan.steps];

  const run = async () => {
    // Initialize all steps to pending
    const initial: Record<string, StepState> = {};
    for (const step of currentSteps) {
      initial[step.id] = { status: 'pending' };
    }
    setStepStates(initial);

    // Freeze the plan into runPlan
    setRunPlan({ ...plan, steps: currentSteps });
    setRunStatus('running');

    for (let stepIdx = 0; stepIdx < currentSteps.length; stepIdx++) {
      if (abortSignal.aborted) break;

      const step = currentSteps[stepIdx];
      const state = initial[step.id];
      if (state?.status === 'done' || state?.status === 'skipped') continue;

      // Check if this is an original step that should trigger middleman
      const originalIdx = plan.steps.indexOf(step);
      const shouldMiddleman = originalIdx >= 0 && middlemanSet.has(originalIdx);

      if (shouldMiddleman) {
        // Simulate: start normally, then fail at melting with no_route
        updateStepState(step.id, { status: 'creatingInvoice' });
        await sleep(600);
        if (abortSignal.aborted) break;

        updateStepState(step.id, { status: 'invoiceReady' });
        await sleep(400);
        if (abortSignal.aborted) break;

        updateStepState(step.id, { status: 'melting' });
        await sleep(800);
        if (abortSignal.aborted) break;

        // Simulate no_route failure → routing
        updateStepState(step.id, {
          status: 'routing',
          errorMessage: undefined,
          routingDetail: 'Searching for middleman route…',
          routeSuggestion: { status: 'searching' },
        });
        await sleep(1000);
        if (abortSignal.aborted) break;

        // Pick intermediaries
        const intermediaries = pickIntermediaries(
          step.fromMintUrl,
          step.toMintUrl,
          mintUrls,
          intermediaryCount
        );
        const chainPath = [step.fromMintUrl, ...intermediaries, step.toMintUrl];
        const chainPathNames = chainPath.map(
          (url) => mintInfoMap[url]?.name || DEMO_MINT_NAMES[url] || url
        );

        updateStepState(step.id, {
          routeSuggestion: { status: 'found', path: chainPath, pathNames: chainPathNames },
          routingDetail: `Routing via ${chainPathNames.slice(1, -1).join(' → ')}…`,
        });
        await sleep(600);
        if (abortSignal.aborted) break;

        // Mark original as skipped
        updateStepState(step.id, {
          status: 'skipped',
          routingDetail: `Routing via ${chainPathNames.slice(1, -1).join(' → ')}…`,
        });

        // Create chain hop steps
        const uniqueSuffix = `demo-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const chainId = `chain-${uniqueSuffix}`;
        const chainSteps: TransferStep[] = [];

        for (let i = 0; i < chainPath.length - 1; i++) {
          chainSteps.push({
            ...step,
            id: `demo-hop-${step.id}-${i}-${uniqueSuffix}`,
            fromMintUrl: chainPath[i],
            toMintUrl: chainPath[i + 1],
            chainId,
            chainPath,
            chainHopIndex: i,
          });
        }

        // Insert chain steps into the plan after the current step
        currentSteps = [
          ...currentSteps.slice(0, stepIdx + 1),
          ...chainSteps,
          ...currentSteps.slice(stepIdx + 1),
        ];

        // Update the run plan and states
        setRunPlan((prev) => {
          if (!prev) return prev;
          return { ...prev, steps: currentSteps };
        });

        // Initialize chain step states
        setStepStates((prev) => {
          const next = { ...prev };
          for (const cs of chainSteps) {
            next[cs.id] = { status: 'pending' };
          }
          return next;
        });

        // Small pause for layout animation
        await sleep(400);
        if (abortSignal.aborted) break;

        // Execute each chain hop
        for (const hopStep of chainSteps) {
          if (abortSignal.aborted) break;
          const ok = await simulateHop(hopStep.id, updateStepState, abortSignal);
          if (!ok) break;
          // Brief pause between hops
          await sleep(300);
        }
      } else if (!step.chainId) {
        // Normal (non-chain) step — run full simulation
        const ok = await simulateHop(step.id, updateStepState, abortSignal);
        if (!ok) break;
        await sleep(400);
      }
      // Chain steps created by middleman are executed inline above, skip here
    }

    if (!abortSignal.aborted) {
      setRunStatus('finished');
    }
  };

  run();

  return {
    abort: () => {
      abortSignal.aborted = true;
      setRunStatus('cancelled');
    },
  };
}
