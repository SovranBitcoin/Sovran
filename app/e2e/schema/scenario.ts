import { z } from 'zod';
import { stepSchema, type Step } from './steps';
import {
  capabilitySchema,
  laneSchema,
  endStateSchema,
  unitSchema,
  PAYMENT_REQUEST_DELIVERY_FAILURE_CAPABILITY,
  MINT_FAULTS_CAPABILITY,
  DEVICE_NETWORK_CAPABILITY,
} from './capabilities';
import { SCHEMA_VERSION } from './version';
import { facetIssues } from './facets';

/** dotted lowercase id, e.g. `send.lightning.sat` */
const dottedId = z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)*$/, 'must be dotted-lowercase');

/** Invoke a reusable flow (fixture) inside setup/finally, with typed params. */
const fixtureUse = z.strictObject({
  use: dottedId,
  with: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
const phaseItem = z.union([fixtureUse, stepSchema]);

/** Maximum value this scenario may place in one exact app-wallet asset. */
export const fundedAssetSchema = z.strictObject({
  mintUrl: z.string().url(),
  unit: unitSchema,
  accountIndex: z.literal(0),
  maxPrincipal: z.number().int().positive().max(200),
});
export type FundedAsset = z.infer<typeof fundedAssetSchema>;

/** A declared app-internal move of value between two funded assets (e.g. the
 * balance-split rebalance melting from one mint to fund another). Reconciliation
 * uses it to explain why the destination restores more than its own principal
 * and the source less, within an explicit fee budget. */
export const fundedTransferSchema = z.strictObject({
  fromMintUrl: z.string().url(),
  toMintUrl: z.string().url(),
  unit: unitSchema,
  accountIndex: z.literal(0),
  maxFeeSats: z.number().int().positive().max(50),
});
export type FundedTransfer = z.infer<typeof fundedTransferSchema>;

export const fundsSchema = z
  .strictObject({
    assets: z.array(fundedAssetSchema).min(1),
    transfers: z.array(fundedTransferSchema).min(1).optional(),
  })
  .superRefine((funds, ctx) => {
    const seen = new Set<string>();
    funds.assets.forEach((asset, index) => {
      const key = `${asset.mintUrl}\u0000${asset.unit}\u0000${asset.accountIndex}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['assets', index],
          message: 'duplicate funded asset location',
        });
      }
      seen.add(key);
    });
    funds.transfers?.forEach((transfer, index) => {
      const hasEndpoint = (mintUrl: string) =>
        funds.assets.some(
          (asset) =>
            asset.mintUrl === mintUrl &&
            asset.unit === transfer.unit &&
            asset.accountIndex === transfer.accountIndex
        );
      if (!hasEndpoint(transfer.fromMintUrl)) {
        ctx.addIssue({
          code: 'custom',
          path: ['transfers', index, 'fromMintUrl'],
          message: 'transfer source must reference a declared funded asset',
        });
      }
      if (!hasEndpoint(transfer.toMintUrl)) {
        ctx.addIssue({
          code: 'custom',
          path: ['transfers', index, 'toMintUrl'],
          message: 'transfer destination must reference a declared funded asset',
        });
      }
      if (transfer.fromMintUrl === transfer.toMintUrl) {
        ctx.addIssue({
          code: 'custom',
          path: ['transfers', index],
          message: 'transfer source and destination must differ',
        });
      }
    });
  });
export type Funds = z.infer<typeof fundsSchema>;

export const scenarioSchema = z
  .strictObject({
    version: z.literal(SCHEMA_VERSION),
    id: dottedId,
    name: z.string().min(1),
    /** Plain-language summary of what the test proves — written for a reader
     * with no knowledge of the harness or protocol jargon. */
    description: z.string().min(1),
    /** Technical companion to `description`: amounts, fault codes, env vars,
     * timing quirks — everything an author debugging a failure needs. */
    details: z.string().min(1).optional(),
    lane: laneSchema,
    tags: z.array(z.string().min(1)).default([]),
    requires: z.array(capabilitySchema).default([]),
    funds: fundsSchema.optional(),
    setup: z.array(phaseItem).default([]),
    steps: z.array(stepSchema).min(1),
    /** Assertions and evidence authored after product behavior; never inferred
     * from action type because a mid-flow assertion may precede more behavior. */
    verify: z.array(stepSchema).min(1),
    finally: z.array(phaseItem).default([]),
    endState: endStateSchema,
    deferredReason: z.string().min(1).optional(),
  })
  .superRefine((scenario, ctx) => {
    for (const message of facetIssues(scenario.tags)) {
      ctx.addIssue({ code: 'custom', path: ['tags'], message });
    }
    const stepsOf = (items: readonly unknown[]): Step[] =>
      items.filter((item): item is Step => !!item && typeof item === 'object' && 'action' in item);
    const phases = {
      setup: stepsOf(scenario.setup),
      steps: stepsOf(scenario.steps),
      verify: stepsOf(scenario.verify),
      finally: stepsOf(scenario.finally),
    };
    const isMintFaultsStep = (step: Step): step is Extract<Step, { action: 'mintFaults' }> =>
      step.action === 'mintFaults';
    const usesMintFaults = Object.values(phases).some(
      (steps) =>
        steps.some(isMintFaultsStep) ||
        steps.some((step) => step.action === 'assert' && step.that === 'mintFaultIntercepted')
    );
    if (usesMintFaults && !scenario.requires.includes(MINT_FAULTS_CAPABILITY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['requires'],
        message: `mintFaults steps/asserts require the ${MINT_FAULTS_CAPABILITY} capability`,
      });
    }
    if (scenario.lane === 'funded') {
      // Funding traffic must be real: faults activate only after setup, and a
      // finally clear must precede the sweep so recovery traffic is real too.
      if (phases.setup.some((step) => isMintFaultsStep(step) && step.rules.length > 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['setup'],
          message: 'funded scenarios must not arm mint-fault rules during setup',
        });
      }
      const armsFaults = [...phases.steps, ...phases.verify].some(
        (step) => isMintFaultsStep(step) && step.rules.length > 0
      );
      const finallyClears = phases.finally.some(
        (step) => isMintFaultsStep(step) && step.rules.length === 0
      );
      if (armsFaults && !finallyClears) {
        ctx.addIssue({
          code: 'custom',
          path: ['finally'],
          message: 'funded fault scenarios must clear mint-fault rules in finally (rules: [])',
        });
      }
    }
    const isNetworkStep = (step: Step): step is Extract<Step, { action: 'network' }> =>
      step.action === 'network';
    const usesNetwork = Object.values(phases).some((steps) => steps.some(isNetworkStep));
    if (usesNetwork && !scenario.requires.includes(DEVICE_NETWORK_CAPABILITY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['requires'],
        message: `network steps require the ${DEVICE_NETWORK_CAPABILITY} capability`,
      });
    }
    // Fund online, then fly: funding/onboard traffic must be real, so airplane
    // mode can never be armed during setup.
    if (phases.setup.some(isNetworkStep)) {
      ctx.addIssue({
        code: 'custom',
        path: ['setup'],
        message: 'network steps are forbidden in setup — fund online, then go airplane in steps',
      });
    }
    const goesAirplane = [...phases.steps, ...phases.verify].some(
      (step) => isNetworkStep(step) && step.mode === 'airplane'
    );
    if (goesAirplane) {
      // The restore must be authored (the driver backstop is a safety net, not
      // the contract) and must precede any sweep so recovery traffic is real.
      const finallyItems = scenario.finally;
      const restoreIndex = finallyItems.findIndex((item) =>
        !!item && typeof item === 'object' && 'action' in item
          ? isNetworkStep(item as Step) &&
            (item as Extract<Step, { action: 'network' }>).mode === 'online'
          : false
      );
      if (restoreIndex === -1) {
        ctx.addIssue({
          code: 'custom',
          path: ['finally'],
          message: 'airplane scenarios must restore network mode:"online" in finally',
        });
      } else {
        const sweepIndex = finallyItems.findIndex(
          (item) =>
            !!item && typeof item === 'object' && 'use' in item && /sweep/.test(String(item.use))
        );
        if (sweepIndex !== -1 && sweepIndex < restoreIndex) {
          ctx.addIssue({
            code: 'custom',
            path: ['finally', sweepIndex],
            message: 'network mode:"online" must precede the sweep in finally',
          });
        }
      }
    }
    if (
      scenario.lane !== 'funded' &&
      scenario.requires.includes(PAYMENT_REQUEST_DELIVERY_FAILURE_CAPABILITY)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['requires'],
        message: `${PAYMENT_REQUEST_DELIVERY_FAILURE_CAPABILITY} requires the funded lane`,
      });
    }
    if (scenario.lane === 'funded' && !scenario.funds) {
      ctx.addIssue({
        code: 'custom',
        path: ['funds'],
        message: 'funded scenarios require an explicit funds.assets contract',
      });
    }
    const totalPrincipal = scenario.funds?.assets.reduce(
      (total, asset) => total + asset.maxPrincipal,
      0
    );
    if (totalPrincipal !== undefined && totalPrincipal > 200) {
      ctx.addIssue({
        code: 'custom',
        path: ['funds', 'assets'],
        message: 'aggregate maxPrincipal must be at most 200 sats',
      });
    }
  });
export type Scenario = z.infer<typeof scenarioSchema>;

/** A reusable flow: parameterized steps, composable via `use`. */
export const fixtureSchema = z.strictObject({
  version: z.literal(SCHEMA_VERSION),
  id: dottedId,
  params: z.array(z.string().min(1)).default([]),
  requires: z.array(capabilitySchema).default([]),
  steps: z.array(phaseItem).min(1),
});
export type Fixture = z.infer<typeof fixtureSchema>;

export { fixtureUse, dottedId };
