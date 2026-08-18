import type { ThemeColor } from 'heroui-native/hooks';
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
 * Tokens this repo owns on top of HeroUI's set. `skeleton` is declared by
 * `themeEngine` and `global.css`, not by heroui.
 */
const APP_SEMANTIC_TOKENS = ['skeleton'] as const;

/**
 * HeroUI's semantic tokens, mirrored so the parity test has the names at
 * runtime — heroui declares them but does not export the array, only the
 * `ThemeColor` union built from it.
 *
 * The two assertions below make this a mirror rather than a copy: `satisfies`
 * rejects a name heroui does not have, and `Exhaustive` fails to compile if
 * heroui gains one this list is missing, naming the token. A `bun update
 * heroui-native` that changes the token set is a type error, not a surprise.
 */
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
  ...APP_SEMANTIC_TOKENS,
] as const satisfies readonly (ThemeColor | AppSemanticToken)[];

type AppSemanticToken = (typeof APP_SEMANTIC_TOKENS)[number];
type SemanticToken = (typeof SEMANTIC_TOKENS)[number];

/** Resolves to `never` only while every heroui token is mirrored above. */
type Exhaustive<T extends never> = T;
type AllHerouiTokensMirrored = Exhaustive<Exclude<ThemeColor, SemanticToken>>;

// `AllHerouiTokensMirrored` is `never`, so it adds nothing to this union — it is
// here so the check above is *used*, and so a heroui upgrade that adds a token
// fails type-check here, naming it, instead of silently falling back at runtime.
type ColorToken = SemanticToken | StaticColorToken | WallpaperToken | AllHerouiTokensMirrored;

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
