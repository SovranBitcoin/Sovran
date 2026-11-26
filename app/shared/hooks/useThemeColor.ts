import { useCSSVariable } from 'uniwind';

import { themeLog } from '@/shared/lib/logger';
import type { StaticColorToken, WallpaperToken } from '@/shared/lib/themeEngine';

/**
 * Extended useThemeColor — resolves ANY color token from CSS variables.
 *
 * Supports semantic tokens (dynamic per theme) AND static color scales.
 * This is the single hook for all runtime color access. For className usage,
 * use Tailwind classes directly: bg-background, text-danger, bg-shade-300, etc.
 *
 * **Where the tokens come from.** Two registries feed this hook:
 *   - `shared/lib/themeEngine.ts` — the static ramps and the semantic vars,
 *     injected at runtime by `Uniwind.updateCSSVariables`.
 *   - `app/global.css` `@theme` — the Tailwind token schema, including the
 *     `color-mix()` steps derived from the semantic vars (every `*-soft`,
 *     `*-hover`, `separator-secondary`, `border-secondary`, …).
 *
 * `__tests__/themeTokens.test.ts` asserts every token here is declared by one
 * of the two, and that no app-owned token is unreachable from this hook.
 *
 * @example
 * const danger = useThemeColor('danger');
 * const [fg, bg] = useThemeColor(['foreground', 'background']);
 * const brandGrad = useThemeColor(['shade-200', 'shade-300', 'shade-400']);
 */

/** Every semantic token, by the name `--color-<token>` declares it under. */
export const SEMANTIC_TOKENS = [
  'background',
  'foreground',
  'surface',
  'surface-foreground',
  'surface-hover',
  'surface-secondary',
  'surface-secondary-foreground',
  'surface-tertiary',
  'surface-tertiary-foreground',
  'overlay',
  'overlay-foreground',
  'backdrop',
  'muted',
  'accent',
  'accent-foreground',
  'segment',
  'segment-foreground',
  'border',
  'separator',
  'focus',
  'link',
  'default',
  'default-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'danger',
  'danger-foreground',
  'field',
  'field-foreground',
  'field-placeholder',
  'field-border',
  'background-secondary',
  'background-tertiary',
  'background-inverse',
  'default-hover',
  'accent-hover',
  'success-hover',
  'warning-hover',
  'danger-hover',
  'field-hover',
  'field-focus',
  'field-border-hover',
  'field-border-focus',
  'default-soft',
  'default-soft-foreground',
  'default-soft-hover',
  'accent-soft',
  'accent-soft-foreground',
  'accent-soft-hover',
  'danger-soft',
  'danger-soft-foreground',
  'danger-soft-hover',
  'warning-soft',
  'warning-soft-foreground',
  'warning-soft-hover',
  'success-soft',
  'success-soft-foreground',
  'success-soft-hover',
  'separator-secondary',
  'separator-tertiary',
  'border-secondary',
  'border-tertiary',
  'skeleton',
] as const;

type SemanticToken = (typeof SEMANTIC_TOKENS)[number];

type ColorToken = SemanticToken | StaticColorToken | WallpaperToken;

type StringTuple<N extends number, A extends string[] = []> = A['length'] extends N
  ? A
  : StringTuple<N, [...A, string]>;

/**
 * Last-resort colour when a variable does not resolve. Deliberately the
 * foreground token rather than a literal: an unresolved token used to return
 * `#000000`, which is invisible on a dark canvas and so shipped unnoticed.
 */
const FALLBACK_VAR = '--color-foreground';
const FALLBACK_COLOR = '#8E8E93';

export function useThemeColor(token: ColorToken): string;
export function useThemeColor<T extends readonly [ColorToken, ...ColorToken[]]>(
  tokens: T
): StringTuple<T['length']>;
export function useThemeColor(tokens: ColorToken[]): string[];
export function useThemeColor(token: ColorToken | ColorToken[]): string | string[] {
  const isArray = Array.isArray(token);
  const requested = isArray ? token : [token as ColorToken];
  const vars = requested.map((t) => `--color-${t}`);

  const resolved = useCSSVariable([...vars, FALLBACK_VAR]);
  const fallback = resolved[vars.length];
  const foreground =
    typeof fallback === 'string' && fallback.length > 0 ? fallback : FALLBACK_COLOR;

  const colors: string[] = vars.map((_, index) => {
    const value = resolved[index];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number') return String(value);

    if (__DEV__) {
      themeLog.error('theme.token.unresolved', {
        token: requested[index],
        variable: vars[index],
      });
    }

    return foreground;
  });

  return isArray ? colors : colors[0]!;
}
