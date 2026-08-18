import { useCSSVariable } from 'uniwind';

import { themeLog } from '@/shared/lib/logger';
import type { StaticColorToken, WallpaperToken } from '@/shared/lib/themeEngine';

/**
 * Extended useThemeColor — resolves ANY color token from CSS variables.
 *
 * Supports HeroUI semantic tokens (dynamic per theme) AND static color scales.
 * This is the single hook for all runtime color access. For className usage,
 * use Tailwind classes directly: bg-background, text-danger, bg-shade-300, etc.
 *
 * **Where the tokens come from.** Three registries feed this hook, only two of
 * which this repo owns:
 *   - `shared/lib/themeEngine.ts` — the static ramps and the HeroUI semantic
 *     vars, injected at runtime by `Uniwind.updateCSSVariables`.
 *   - `app/global.css` `@theme` — the Tailwind token schema.
 *   - `heroui-native/lib/module/styles/theme.css` — a **vendored** `@theme
 *     inline static` block that derives ~22 of the semantic tokens below with
 *     `color-mix()` (every `*-soft`, `*-hover`, `separator-secondary`,
 *     `border-secondary`, `background-secondary`, …). Those are not ours; a
 *     heroui upgrade can remove one.
 *
 * `__tests__/themeTokens.test.ts` asserts every token here is declared by one
 * of the three, and that no app-owned token is unreachable from this hook.
 * Run it after `bun update heroui-native`.
 *
 * @example
 * const danger = useThemeColor('danger');
 * const [fg, bg] = useThemeColor(['foreground', 'background']);
 * const brandGrad = useThemeColor(['shade-200', 'shade-300', 'shade-400']);
 */

/**
 * HeroUI semantic tokens. Hand-maintained because 22 of them are declared by
 * vendored heroui CSS rather than by this repo — see the note above. Keep it a
 * `const` array, not a bare union: the parity test needs the names at runtime.
 */
export const SEMANTIC_TOKENS = [
  'background',
  'background-secondary',
  'background-tertiary',
  'background-inverse',
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
  'muted',
  'default',
  'default-foreground',
  'default-hover',
  'accent',
  'accent-foreground',
  'accent-hover',
  'accent-soft',
  'accent-soft-foreground',
  'danger',
  'danger-foreground',
  'danger-hover',
  'danger-soft',
  'danger-soft-foreground',
  'success',
  'success-foreground',
  'success-hover',
  'success-soft',
  'success-soft-foreground',
  'warning',
  'warning-foreground',
  'warning-hover',
  'warning-soft',
  'warning-soft-foreground',
  'segment',
  'segment-foreground',
  'skeleton',
  'border',
  'border-secondary',
  'border-tertiary',
  'separator',
  'separator-secondary',
  'separator-tertiary',
  'focus',
  'link',
  'field',
  'field-foreground',
  'field-placeholder',
  'field-border',
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
