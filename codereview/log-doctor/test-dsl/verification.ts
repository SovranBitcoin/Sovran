/**
 * @fileoverview Sovran Test DSL — verification metadata writer.
 *
 * On test pass, the runner needs to update the `# verified: ...` comment
 * inside the test block. The trick: do it in-place, line-by-line, WITHOUT
 * re-serialising the source file. This preserves the user's exact
 * whitespace, blank lines, and unrelated comments.
 *
 * Format:
 *   `  # verified: 2026-04-10 13:01:42 — iphone (iOS 26.1)`
 *
 * If a `# verified:` line already exists inside the test block, replace it.
 * Otherwise, insert one immediately before the test's closing `end` line.
 */

import * as fs from 'fs';

import type { MatrixDef, Test } from './ast';
import type { ExecuteMatrixResult } from './executor';

export interface DeviceInfo {
  /** Free-text device label (e.g. "iphone (iOS 26.1)"). */
  label: string;
}

/**
 * Update or insert the `# verified: ...` line for `test` in the given
 * `.sov` file. Reads the file, splices the relevant line, writes back.
 *
 * `test.pos.line` is the line of the `test "..."` opener; the body runs
 * until the next matching `end` (also a top-level statement). We scan
 * forward from the opener for either an existing `# verified:` line or
 * the closing `end`.
 */
export function writeVerifiedComment(
  filePath: string,
  test: Test,
  device: DeviceInfo,
  now: Date = new Date()
): void {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');

  // 1-indexed → 0-indexed for array access.
  const startIdx = test.pos.line - 1;
  if (startIdx < 0 || startIdx >= lines.length) return;

  // Walk forward from the test opener. Find the first stand-alone `end`
  // at the same nesting level (we know `test` cannot be nested, so the
  // FIRST `end` we encounter is the closing one). Track any existing
  // `# verified:` line along the way.
  let endIdx = -1;
  let verifiedIdx = -1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === 'end') {
      endIdx = i;
      break;
    }
    if (/^#\s*verified\s*:/i.test(trimmed)) {
      verifiedIdx = i;
    }
  }

  if (endIdx === -1) return; // malformed — bail without writing

  const newLine = formatVerifiedLine(now, device.label, indentOfClosingBlock(lines, endIdx));

  if (verifiedIdx !== -1) {
    lines[verifiedIdx] = newLine;
  } else {
    // Insert before `end`. Preserve any blank-line padding above `end`.
    let insertAt = endIdx;
    // Skip back over any blank lines so the new comment sits flush against
    // the last test step (matches the spec example).
    while (insertAt > 0 && lines[insertAt - 1].trim() === '') insertAt--;
    lines.splice(insertAt, 0, newLine);
  }

  fs.writeFileSync(filePath, lines.join('\n'));
}

function formatVerifiedLine(now: Date, deviceLabel: string, indent: string): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${indent}# verified: ${date} ${time} — ${deviceLabel}`;
}

/**
 * Match the indent of the closing `end` line so the inserted verified
 * comment sits at the same level as the rest of the test body.
 */
function indentOfClosingBlock(lines: string[], endIdx: number): string {
  const endLine = lines[endIdx] || '';
  const m = /^(\s*)/.exec(endLine);
  // The body is indented one level deeper than `end` — add two spaces.
  return (m ? m[1] : '') + '  ';
}

// ─── Matrix result table writer ────────────────────────────────────────────

/**
 * Update (or insert) the `# verified: …` result table inside a matrix
 * block. Shares the "find the block, scan to `end`, splice before the
 * closer" mechanics with `writeVerifiedComment` but has its own shape:
 * a header line plus one line per cell, all as comments stamped at the
 * same indent as the rest of the matrix body.
 *
 * Example:
 *   # verified: verbose × 8 cells on 2026-04-11 10:05:42 — iphone (iOS 26.1)
 *   #   [PASS] mint=mint-no-fees amount=via-keypad bundle teardown=dismiss
 *   #   [PASS] mint=mint-no-fees amount=via-keypad bundle teardown=cancel
 *   #   [FAIL] mint=mint-no-fees amount=via-chip   bundle teardown=cancel — "Cancelled" toast not visible
 *   …
 *
 * Any prior verified-comment run (whose line range is captured at
 * parse time in `matrix.verification`) is replaced wholesale. The
 * rewriter is byte-stable everywhere else in the file — same discipline
 * as the per-test stamper.
 */
export function writeMatrixResultTable(
  filePath: string,
  matrix: MatrixDef,
  result: ExecuteMatrixResult,
  device: DeviceInfo
): void {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');

  const startIdx = matrix.pos.line - 1;
  if (startIdx < 0 || startIdx >= lines.length) return;

  // Walk forward from the matrix opener to find the matching `end`.
  // Matrices can't nest (parser enforces top-level-only), so the first
  // standalone `end` is ours. We also respect nested `stage … end`
  // sub-blocks by tracking depth: entering a `stage …` line increments,
  // an `end` decrements. The matrix closes when depth goes from 0 to
  // -1 on an `end` line.
  let endIdx = -1;
  let depth = 0;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === 'end') {
      if (depth === 0) {
        endIdx = i;
        break;
      }
      depth--;
      continue;
    }
    if (trimmed.startsWith('stage ')) depth++;
  }
  if (endIdx === -1) return;

  const indent = indentOfClosingBlock(lines, endIdx);
  const newLines = formatMatrixResultLines(result, device.label, indent);

  // If the matrix already had a verification block, replace exactly
  // that range. Otherwise, insert immediately before `end`, preserving
  // any blank-line padding above the closer.
  if (matrix.verification) {
    const removeFrom = matrix.verification.firstLine - 1;
    const removeToInclusive = matrix.verification.lastLine - 1;
    lines.splice(removeFrom, removeToInclusive - removeFrom + 1, ...newLines);
  } else {
    let insertAt = endIdx;
    while (insertAt > 0 && lines[insertAt - 1].trim() === '') insertAt--;
    lines.splice(insertAt, 0, ...newLines);
  }

  fs.writeFileSync(filePath, lines.join('\n'));
}

function formatMatrixResultLines(
  result: ExecuteMatrixResult,
  deviceLabel: string,
  indent: string
): string[] {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const now = result.startedAt;
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const header = `${indent}# verified: ${result.mode} × ${result.cells.length} cell${
    result.cells.length === 1 ? '' : 's'
  } on ${date} ${time} — ${sanitizeStampValue(deviceLabel)}`;

  // Align tuple labels so the status column lines up even when tuples
  // vary in length. Padding is computed from the longest label in this
  // run so the table grows predictably.
  const longestLabel = Math.max(...result.cells.map((c) => c.tupleLabel.length), 0);
  const rows = result.cells.map((cell) => {
    const tag = cell.ok ? '[PASS]' : '[FAIL]';
    const labelPadded = cell.tupleLabel.padEnd(longestLabel);
    // Defensively scrub any newlines, carriage returns, or stray `end`
    // tokens from the error string before splicing into the stamp.
    // The executor should already be emitting single-line errors, but
    // the stamp rewriter is the last line of defence against a
    // mis-behaving upstream emitting a multi-line string and corrupting
    // the comment block in the source file — which WOULD then break
    // parse on the next run.
    const errorSuffix =
      !cell.ok && cell.error ? ` — ${sanitizeStampValue(cell.error)}` : '';
    return `${indent}#   ${tag} ${labelPadded}${errorSuffix}`;
  });

  return [header, ...rows];
}

/**
 * Flatten any value that gets embedded into a `# verified:` comment
 * line. Replaces newlines and carriage returns with visible markers
 * and truncates to a safe length. The resulting string is guaranteed
 * to be single-line so the rewriter can't poison the .sov file.
 */
function sanitizeStampValue(raw: string): string {
  const cleaned = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\n+/g, ' ↩ ')
    .replace(/\s+/g, ' ')
    .trim();
  const max = 140;
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1) + '…';
}
