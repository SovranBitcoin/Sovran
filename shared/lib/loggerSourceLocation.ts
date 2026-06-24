/**
 * Caller source-location resolution for the structured logger.
 *
 * Pure stack-trace parsing: turn a `new Error().stack` frame into a compact
 * `{ file, func, line }` for the log entry's `src`. No logger state, no I/O.
 */

interface SourceLocation {
  file: string;
  func: string;
  line: number;
}

function simplifyPath(fullPath: string): string {
  const cleaned = fullPath
    .replace(/^file:\/\//, '')
    .replace(/\?.*$/, '')
    .replace(/\/\/&.*$/, '');
  const parts = cleaned.split(/[\\/]/);
  return parts.slice(-3).join('/');
}

export function getCallerLocation(stackOffset: number = 3): SourceLocation {
  const fallback: SourceLocation = { file: 'unknown', func: 'unknown', line: 0 };
  try {
    const stack = new Error('source-location probe').stack;
    if (!stack) return fallback;
    const lines = stack.split('\n');
    const target = lines[stackOffset];
    if (!target) return fallback;
    let match = target.match(/at\s+(.+?)\s+\((.+):(\d+):\d+\)/);
    if (match)
      return { func: match[1], file: simplifyPath(match[2]), line: parseInt(match[3], 10) };
    match = target.match(/at\s+(.+):(\d+):\d+/);
    if (match)
      return { func: '<anonymous>', file: simplifyPath(match[1]), line: parseInt(match[2], 10) };
    return fallback;
  } catch {
    return fallback;
  }
}
