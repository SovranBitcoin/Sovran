import { useCSSVariable } from 'uniwind';

/**
 * Extended useThemeColor — resolves ANY color token from CSS variables.
 *
 * Supports HeroUI semantic tokens (dynamic per theme) AND static color scales.
 * This is the single hook for all runtime color access. For className usage,
 * use Tailwind classes directly: bg-background, text-danger, bg-shade-300, etc.
 *
 * @example
 * const danger = useThemeColor('danger');
 * const [fg, bg] = useThemeColor(['foreground', 'background']);
 * const brandGrad = useThemeColor(['shade-200', 'shade-300', 'shade-400']);
 */

type Shade = 100 | 200 | 300 | 400 | 500;

type StaticScale =
  | `shade-${Shade}`
  | `red-${Shade}`
  | `green-${Shade}`
  | `yellow-${Shade}`
  | `blue-${Shade}`
  | `purple-${Shade}`
  | `orange-${Shade}`;

type SemanticToken =
  | 'background'
  | 'foreground'
  | 'surface'
  | 'surface-foreground'
  | 'surface-hover'
  | 'surface-secondary'
  | 'surface-secondary-foreground'
  | 'surface-tertiary'
  | 'surface-tertiary-foreground'
  | 'overlay'
  | 'overlay-foreground'
  | 'muted'
  | 'default'
  | 'default-foreground'
  | 'default-hover'
  | 'accent'
  | 'accent-foreground'
  | 'accent-hover'
  | 'accent-soft'
  | 'accent-soft-foreground'
  | 'danger'
  | 'danger-foreground'
  | 'danger-hover'
  | 'danger-soft'
  | 'danger-soft-foreground'
  | 'success'
  | 'success-foreground'
  | 'success-hover'
  | 'success-soft'
  | 'success-soft-foreground'
  | 'warning'
  | 'warning-foreground'
  | 'warning-hover'
  | 'warning-soft'
  | 'warning-soft-foreground'
  | 'segment'
  | 'segment-foreground'
  | 'border'
  | 'separator'
  | 'separator-secondary'
  | 'separator-tertiary'
  | 'border-secondary'
  | 'border-tertiary'
  | 'focus'
  | 'link'
  | 'field'
  | 'field-foreground'
  | 'field-placeholder'
  | 'field-border'
  | 'background-secondary'
  | 'background-tertiary'
  | 'background-inverse';

export type ColorToken = SemanticToken | StaticScale;

type StringTuple<N extends number, A extends string[] = []> = A['length'] extends N
  ? A
  : StringTuple<N, [...A, string]>;

export function useThemeColor(token: ColorToken): string;
export function useThemeColor<T extends readonly [ColorToken, ...ColorToken[]]>(
  tokens: T
): StringTuple<T['length']>;
export function useThemeColor(tokens: ColorToken[]): string[];
export function useThemeColor(token: ColorToken | ColorToken[]): string | string[] {
  const isArray = Array.isArray(token);
  const vars = isArray ? token.map((t) => `--color-${t}`) : [`--color-${token as ColorToken}`];

  const resolved = useCSSVariable(vars);
  const colors: string[] = resolved.map((c) => {
    if (typeof c === 'string' && c.length > 0) return c;
    if (typeof c === 'number') return String(c);
    return '#000000';
  });

  return isArray ? colors : colors[0]!;
}
