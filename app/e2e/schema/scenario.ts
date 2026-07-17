import { z } from 'zod';
import { stepSchema } from './steps';
import {
  capabilitySchema,
  laneSchema,
  endStateSchema,
  unitSchema,
  PAYMENT_REQUEST_DELIVERY_FAILURE_CAPABILITY,
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
    description: z.string().min(1),
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
