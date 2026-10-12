/**
 * A user story: one thing a person does with the app, and what must be true
 * afterwards (ADR 0033).
 *
 * A step issues at most one action, once. It is never retried and never waits
 * for a length of time: after the action the runner waits for the app to say
 * its screen is still, then for everything the step expects to be true.
 */
import { z } from 'zod';
import { selectorSchema } from '../schema/selectors';

/** Something that must be true on screen or in the app's log. */
const expectationSchema = z.union([
  /** An element is laid out on screen. */
  z.strictObject({ visible: selectorSchema }),
  /** No such element is laid out. */
  z.strictObject({ gone: selectorSchema }),
  /** The topmost page is this `Screen`. */
  z.strictObject({ page: z.string().min(1) }),
  /** The app logged this event during the step, with these params if given. */
  z.strictObject({
    logged: z.string().min(1),
    with: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  }),
]);
export type Expectation = z.infer<typeof expectationSchema>;

const stepSchema = z.strictObject({
  /** What the person does, in a few words; names the step in the report. */
  name: z.string().min(1).max(80),
  /** Tap the centre of this element. */
  tap: selectorSchema.optional(),
  expect: z.array(expectationSchema).min(1),
  /** How long the expectations may take. Only a step that waits on a mint or a relay needs more. */
  withinMs: z.number().int().min(100).max(60_000).default(5000),
});
export type Step = z.infer<typeof stepSchema>;

export const storySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  /** One sentence: who does what, and what they see when it has worked. */
  purpose: z.string().min(20).max(240),
  steps: z.array(stepSchema).min(1),
});
export type Story = z.infer<typeof storySchema>;
