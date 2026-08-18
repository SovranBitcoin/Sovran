/**
 * @jest-environment node
 *
 * Parity gate for the colour-token system.
 *
 * `useThemeColor`'s token list is hand-maintained, but the variables it resolves
 * come from three separate registries — two owned by this repo, one vendored:
 *
 *   1. `shared/lib/themeEngine.ts`      — injected at runtime by Uniwind
 *   2. `app/global.css` `@theme`        — the Tailwind token schema
 *   3. `heroui-native/.../theme.css`    — VENDORED `@theme inline static`, which
 *                                         derives ~22 tokens via `color-mix()`
 *
 * Nothing else compares them. An unresolved token does not throw — it falls back
 * to a neutral grey — so a heroui upgrade that renames `--color-separator-secondary`
 * would quietly repaint ten separators with no error anywhere. This test is that
 * error. Run it after `bun update heroui-native`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { SEMANTIC_TOKENS } from '@/shared/hooks/useThemeColor';
import {
  STATIC_COLOR_TOKENS,
  WALLPAPER_TOKENS,
  getThemeVariables,
  themeVariables,
} from '@/shared/lib/themeEngine';

// Hoisted above the imports by babel-plugin-jest-hoist; keeps this a node-only test.
jest.mock('uniwind', () => ({ useCSSVariable: () => [] }));

/** `--surface-shadow` and friends are box-shadow strings, not colours. */
const NON_COLOUR_VAR = /-shadow$/;

/**
 * heroui exposes `--field-background` under the shorter token name `field`
 * (`--color-field: var(--field-background, var(--default))`).
 */
const VAR_TO_TOKEN_ALIAS: Record<string, string> = { 'field-background': 'field' };

function resolveHerouiThemeCss(): string {
  const candidates = [
    path.resolve(__dirname, '../node_modules/heroui-native/lib/module/styles/theme.css'),
    path.resolve(__dirname, '../../node_modules/heroui-native/lib/module/styles/theme.css'),
  ];
  const found = candidates.find((file) => fs.existsSync(file));

  if (!found) {
    throw new Error(`heroui-native theme.css not found. Looked in:\n  ${candidates.join('\n  ')}`);
  }

  return found;
}

/** Every `--color-*` custom property declared in a CSS file. */
function declaredColorVars(file: string): string[] {
  const css = fs.readFileSync(file, 'utf8');

  return [...css.matchAll(/^\s*(--color-[a-z0-9-]+)\s*:/gm)].map((match) => match[1]!);
}

const ALL_COLOR_TOKENS = [...SEMANTIC_TOKENS, ...STATIC_COLOR_TOKENS, ...WALLPAPER_TOKENS];

describe('colour tokens', () => {
  const declared = new Set<string>([
    ...Object.keys(getThemeVariables('dark')),
    ...declaredColorVars(path.resolve(__dirname, '../global.css')),
    ...declaredColorVars(resolveHerouiThemeCss()),
  ]);

  it('has no duplicate token names', () => {
    expect(new Set(ALL_COLOR_TOKENS).size).toBe(ALL_COLOR_TOKENS.length);
  });

  it.each(ALL_COLOR_TOKENS)('token %s is declared by some registry', (token) => {
    // A token missing here resolves to the fallback grey at runtime, silently.
    expect(declared.has(`--color-${token}`)).toBe(true);
  });

  it('exposes every colour variable themeEngine sets as a token', () => {
    const tokens = new Set<string>(ALL_COLOR_TOKENS);

    const unreachable = Object.keys(getThemeVariables('dark'))
      .filter((name) => !name.startsWith('--color-'))
      .map((name) => name.slice('--'.length))
      .filter((name) => !NON_COLOUR_VAR.test(name))
      .map((name) => VAR_TO_TOKEN_ALIAS[name] ?? name)
      .filter((name) => !tokens.has(name));

    expect(unreachable).toEqual([]);
  });

  it('gives every theme a concrete value for every variable it declares', () => {
    // themeEngine sets the base `--x` form; `--color-x` is the Tailwind alias
    // that global.css / heroui map onto it, so check the base names here.
    const empty: string[] = [];

    for (const [themeName, vars] of Object.entries(themeVariables)) {
      for (const [name, value] of Object.entries(vars)) {
        if (typeof value !== 'string' || value.trim() === '') {
          empty.push(`${themeName} ${name}`);
        }
      }
    }

    expect(empty).toEqual([]);
  });

  it('declares both var forms for the static ramps', () => {
    // Uniwind resolves `var()` chains, but the static ramps are also read
    // directly as `--shade-300` by the wallpaper layer, so both forms must exist.
    const vars = getThemeVariables('dark');

    for (const token of STATIC_COLOR_TOKENS) {
      expect(vars[`--${token}`]).toBe(vars[`--color-${token}`]);
      expect(vars[`--${token}`]).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });
});
