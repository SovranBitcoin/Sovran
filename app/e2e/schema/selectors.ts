import { z } from 'zod';

/**
 * A selector picks one element from the accessibility tree. Structured (not a
 * mini-language) so it validates strictly:
 *  - {id}                       exact accessibility id / testID
 *  - {idPrefix, matchIndex?, captureSuffixAs?} prefix match (dynamic ids like
 *                               `send-token-id-<uuid>`), optionally selecting the
 *                               zero-based visible match and capturing its suffix
 *  - {label}                    exact visible label / accessibility label
 *
 * Exactly one of the three forms via a discriminated shape enforced by refine.
 */
const idSelector = z.strictObject({ id: z.string().min(1) });
const prefixSelector = z.strictObject({
  idPrefix: z.string().min(1),
  matchIndex: z.number().int().min(0).max(100).optional(),
  captureSuffixAs: z.string().min(1).optional(),
});
const nonCapturingPrefixSelector = z.strictObject({
  idPrefix: z.string().min(1),
  matchIndex: z.number().int().min(0).max(100).optional(),
});
const labelSelector = z.strictObject({ label: z.string().min(1) });

export const selectorSchema = z.union([idSelector, prefixSelector, labelSelector]);
/** Actions other than waitFor cannot observe the uniquely matched node, so a
 * capture marker there would be inert and is rejected at schema validation. */
export const nonCapturingSelectorSchema = z.union([
  idSelector,
  nonCapturingPrefixSelector,
  labelSelector,
]);
export type Selector = z.infer<typeof selectorSchema>;
