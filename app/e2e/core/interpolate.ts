/**
 * `${param}` interpolation for reusable-flow parameters and captured variables.
 * Fails closed on an unknown reference. Leaves runtime placeholders that are not
 * `${...}` (e.g. a literal `$CLIPBOARD`) untouched — those are resolved by the
 * driver at execution time, not at plan time.
 */
import { isSecret, type Secret } from './redact';

export type Vars = Record<string, string | number | boolean | Secret>;

const REF = /\$\{([a-zA-Z0-9_]+)\}/g;
const EXACT_REF = /^\$\{([a-zA-Z0-9_]+)\}$/;

// `strict` (default) fails closed on an unknown reference — used at RUNTIME where
// every ${var} must have been captured. Plan-time fixture-param expansion uses
// strict:false, leaving unresolved ${...} (runtime captures) intact for the
// orchestrator to fill later.
export function interpolate(input: string, vars: Vars, strict = true): string {
  return input.replace(REF, (_m, name: string) => {
    if (name in vars) {
      if (isSecret(vars[name])) {
        throw new Error(`secret parameter \${${name}} must occupy the entire field`);
      }
      return String(vars[name]);
    }
    if (strict) throw new Error(`unknown parameter \${${name}}`);
    return `\${${name}}`;
  });
}

export function interpolateDeep<T>(node: T, vars: Vars, strict = true): T {
  if (typeof node === 'string') {
    const exact = node.match(EXACT_REF);
    if (exact) {
      const name = exact[1];
      if (name in vars) return vars[name] as unknown as T;
      if (strict) throw new Error(`unknown parameter \${${name}}`);
      return node;
    }
    return interpolate(node, vars, strict) as unknown as T;
  }
  if (Array.isArray(node)) return node.map((v) => interpolateDeep(v, vars, strict)) as unknown as T;
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [k, interpolateDeep(v, vars, strict)])
    ) as T;
  }
  return node;
}
