import { expect } from "vitest";

import type { FlowContext, StepDataMap } from "../../src/machine/types";

interface StepResult<S extends keyof StepDataMap = keyof StepDataMap> {
  step: S;
  context: FlowContext;
  data: StepDataMap[S];
}

/**
 * Assert which step a transition landed on, and narrow its `data` to that
 * step's shape.
 *
 * `expect(result.step).toBe('selectMint')` proves the step at runtime but tells
 * TypeScript nothing, so every read of a step-specific field
 * (`result.data.candidates`, `result.data.preselectedMintUrl`) sat on the whole
 * `StepDataMap` union. Those reads only ever compiled because `wallet`'s
 * tsconfig excluded `__tests__`. This keeps the runtime assertion and gives the
 * compiler the same fact — no cast, and a wrong step still fails the test.
 */
export function assertStep<S extends keyof StepDataMap>(
  result: StepResult,
  step: S,
): asserts result is StepResult<S> {
  expect(result.step).toBe(step);
}
