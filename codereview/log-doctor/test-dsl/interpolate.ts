/**
 * @fileoverview ${var} interpolation for the Sovran Test DSL.
 *
 * Lifted from log-doctor.ts so the parser, executor, and wallet modules
 * can all interpolate without depending on the runner. Behaviour matches
 * the previous YAML runner exactly: undefined references throw with the
 * full list of bound variable names so test authors can spot typos
 * immediately.
 */

const VAR_REFERENCE_RE = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/**
 * Replace `${name}` references in a string with the matching value from
 * `vars`. Throws if a referenced variable is undefined.
 *
 * Recurses into arrays and nested objects so the same function can walk
 * an entire AST argument structure (e.g. an `assert-eq` object form
 * with `a` / `b` keys) without the caller having to know the shape.
 */
export function interpolate(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(VAR_REFERENCE_RE, (_match, name) => {
      if (!(name in vars)) {
        const bound = Object.keys(vars).join(', ') || 'none';
        throw new Error(`undefined variable '${name}' (bound: ${bound})`);
      }
      return vars[name];
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, vars));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) {
      out[k] = interpolate((value as Record<string, unknown>)[k], vars);
    }
    return out;
  }
  return value;
}

/**
 * Convenience: interpolate a string and assert the result is a string.
 * Most call sites in the executor know they're operating on a string
 * argument and want to skip the type narrowing dance.
 */
export function interpolateString(value: string, vars: Record<string, string>): string {
  return interpolate(value, vars) as string;
}
