/**
 * @fileoverview Shared result types for the Sovran Test DSL runner.
 *
 * Lives in its own file so `executor.ts` (which produces these) and
 * `verification.ts` (which consumes them when stamping `# verified:`)
 * can both reach them without forming a cycle through `index.ts`.
 */

import type { MatrixMode } from './ast';

/** One cell's execution outcome plus its tuple description. */
export interface MatrixCellResult {
  /** Human display name used for the synthesized `Test`, screenshots, snapshot dir. */
  cellName: string;
  /** Compact per-stage picks, e.g. `mint=mint-no-fees amount=via-keypad bundle teardown=dismiss`. */
  tupleLabel: string;
  /** Pass/fail. */
  ok: boolean;
  /** First error message if the cell failed, suitable for a one-line stamp. */
  error?: string;
}

export interface ExecuteMatrixResult {
  ok: boolean;
  cells: MatrixCellResult[];
  mode: MatrixMode;
  /** Wall-clock start time, used by the stamping writer. */
  startedAt: Date;
}
