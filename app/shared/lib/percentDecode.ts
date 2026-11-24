/**
 * Percent-decoding for the filters that keep secrets out of navigation state
 * and saved history (`app/+native-intent.tsx`, `scanHistoryStore`).
 *
 * Decodes until nothing changes, so a payload encoded any number of times is
 * seen as itself, and keeps decoding valid runs when a malformed escape (`%ZZ`)
 * sits elsewhere in the text. Bounded by `MAX_PASSES`; a value still changing
 * after that is reported unsettled, and the filters treat it as a secret
 * rather than let an encoding depth decide what they see.
 *
 * Imports nothing: the native intent runs before the app has started.
 */

const MAX_PASSES = 16;

function decodeOnce(value: string): string {
  return value.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      // Not valid UTF-8 as a run: decode its ASCII escapes, keep the rest.
      return run.replace(/%[0-9a-fA-F]{2}/g, (hex) => {
        const code = Number.parseInt(hex.slice(1), 16);
        return code < 0x80 ? String.fromCharCode(code) : hex;
      });
    }
  });
}

/** `value` decoded to its fixed point, and whether it got there within the bound. */
export function percentDecodeFully(value: string): { decoded: string; settled: boolean } {
  let current = value;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    if (!current.includes('%')) return { decoded: current, settled: true };
    const next = decodeOnce(current);
    if (next === current) return { decoded: current, settled: true };
    current = next;
  }
  return { decoded: current, settled: decodeOnce(current) === current };
}
