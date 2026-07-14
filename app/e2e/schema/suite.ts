import { z } from 'zod';
import { capabilitySchema, laneSchema, endStateSchema } from './capabilities';
import { dottedId } from './scenario';
import { SCHEMA_VERSION } from './version';

/** One ordered reference to a scenario file. `newInstance` begins a fresh
 * simulator session; false keeps the preceding simulator scenario in the same
 * owned ephemeral session. Kept compact: one record per physical line. */
const scenarioRef = z.strictObject({
  id: dottedId,
  file: z
    .string()
    .min(1)
    .regex(/^scenarios\/.+\.json$/, 'must be a scenarios/*.json path'),
  order: z.number().int().min(0),
  newInstance: z.boolean(),
  lane: laneSchema,
  requires: z.array(capabilitySchema).default([]),
  endState: endStateSchema.optional(),
});

export const suiteSchema = z
  .strictObject({
    version: z.literal(SCHEMA_VERSION),
    name: z.string().min(1),
    defaultEndState: endStateSchema.default('wallet'),
    scenarios: z.array(scenarioRef).min(1),
  })
  .superRefine((suite, ctx) => {
    const ordered = [...suite.scenarios].sort((left, right) => left.order - right.order);
    ordered.forEach((scenario, index) => {
      const predecessor = ordered[index - 1];
      if (
        !scenario.newInstance &&
        (scenario.lane !== 'simulator' || predecessor?.lane !== 'simulator')
      ) {
        const authoredIndex = suite.scenarios.indexOf(scenario);
        ctx.addIssue({
          code: 'custom',
          path: ['scenarios', authoredIndex, 'newInstance'],
          message: 'simulator reuse requires an adjacent ordinary simulator predecessor',
        });
      }
    });
  });
export type Suite = z.infer<typeof suiteSchema>;

export { SCHEMA_VERSION };
