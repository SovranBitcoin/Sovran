/**
 * Compact-format check. Test JSON must be valid JSON (not JSONC) with each
 * record in a `steps`/`verify`/`scenarios`/`setup`/`finally` array on its own physical
 * line, so execution order is visually obvious and a generic prettier pass
 * (which explodes objects across lines) is rejected. `formatDoc` is the
 * canonical form (also the auto-fixer); `checkCompact` compares against it.
 */
const RECORD_ARRAY_KEYS = new Set(['steps', 'verify', 'scenarios', 'setup', 'finally']);
const pad = (n: number, s: string) => ' '.repeat(n) + s;

export function formatDoc(v: unknown): string {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('compact doc must be a JSON object');
  const entries = Object.entries(v as Record<string, unknown>);
  const lines: string[] = ['{'];
  entries.forEach(([k, val], idx) => {
    const comma = idx < entries.length - 1 ? ',' : '';
    if (RECORD_ARRAY_KEYS.has(k) && Array.isArray(val) && val.length > 0) {
      lines.push(pad(2, `${JSON.stringify(k)}: [`));
      val.forEach((el, i) =>
        lines.push(pad(4, JSON.stringify(el) + (i < val.length - 1 ? ',' : '')))
      );
      lines.push(pad(2, `]${comma}`));
    } else {
      lines.push(pad(2, `${JSON.stringify(k)}: ${JSON.stringify(val)}${comma}`));
    }
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

export function checkCompact(text: string): { ok: boolean; expected?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const expected = formatDoc(parsed);
  return text.trim() === expected.trim() ? { ok: true } : { ok: false, expected };
}
