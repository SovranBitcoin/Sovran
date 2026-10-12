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

const stepSchema = z
  .strictObject({
    /** What the person does, in a few words; names the step in the report. */
    name: z.string().min(1).max(80),
    /** Tap this element: its centre, unless `tapAt` says where. */
    tap: selectorSchema.optional(),
    /**
     * Where in the element to tap, as fractions of its width and height from its
     * top left. For a control that something else partly covers, where a person
     * would press the part they can see.
     */
    tapAt: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
    /**
     * Drag a finger across the screen, starting at the centre of an element:
     * `up` moves the finger up, which scrolls content down or lifts a sheet.
     * `distance` is a fraction of the screen in that direction.
     */
    swipe: z
      .strictObject({
        on: selectorSchema,
        direction: z.enum(['up', 'down', 'left', 'right']),
        distance: z.number().min(0.05).max(0.9).default(0.3),
      })
      .optional(),
    expect: z.array(expectationSchema).min(1),
    /** How long the expectations may take. Only a step that waits on a mint or a relay needs more. */
    withinMs: z.number().int().min(100).max(60_000).default(5000),
  })
  .refine((step) => !(step.tap && step.swipe), 'A step does one thing: a tap or a swipe, not both.')
  .refine(
    (step) => !step.tapAt || step.tap,
    '`tapAt` says where in the tapped element; it needs `tap`.'
  );
export type Step = z.infer<typeof stepSchema>;

export const storySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  /** One sentence: who does what, and what they see when it has worked. */
  purpose: z.string().min(20).max(240),
  /**
   * The state the app is in when the story begins: `fresh` (never opened), or
   * the id of a story in `states/`, whose end is where this one starts. The
   * state is copied into place; nothing is tapped through to reach it.
   */
  startsFrom: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  steps: z.array(stepSchema).min(1),
});
export type Story = z.infer<typeof storySchema>;
