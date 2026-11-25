/**
 * Profile's "Show" and "Copy" buttons are the shared secondary button with its
 * own ink, which clears WCAG AA (4.5:1) on every built-in palette. They used a
 * muted label, which fell as low as 1.7:1 on Dark.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderHook } from '@testing-library/react-native';

import { contrastRatio } from '@/shared/lib/color';
import { BUILTIN_COLOR_THEME_NAMES } from '@/shared/lib/theme/builtinAlbums';
import { getThemeVariables } from '@/shared/lib/themeEngine';
import { useStylePaint } from '@/shared/styles/appStyle';

const mockPalette: Record<string, string> = {};
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: string | readonly string[]) =>
    Array.isArray(token) ? token.map((t) => mockPalette[t]) : mockPalette[token as string],
}));

const AA = 4.5;

describe('Profile Show and Copy buttons', () => {
  it.each(BUILTIN_COLOR_THEME_NAMES)('clear AA on the %s palette', (theme) => {
    const vars = getThemeVariables(theme);
    mockPalette.foreground = vars['--foreground']!;
    mockPalette.surface = vars['--surface']!;
    const { result } = renderHook(() => useStylePaint());
    const fill = result.current.secondary.container.backgroundColor;
    expect(typeof fill).toBe('string');
    expect(contrastRatio(result.current.secondary.content, fill as string)).toBeGreaterThanOrEqual(
      AA
    );
  });

  it('use the button ink, never a muted override', () => {
    const source = readFileSync(
      resolve(__dirname, '../features/settings/components/ProfileDetailsScreen.tsx'),
      'utf8'
    );
    expect(source).not.toContain('contentColor=');
    expect(source).not.toContain('text-muted');
    expect(source).not.toContain('HerouiButton');
    expect(source.match(/color=\{paint\.secondary\.content\}/g)).toHaveLength(2);
  });

  it('draws the Edit profile pencil in the primary button ink, like its label', () => {
    const source = readFileSync(
      resolve(__dirname, '../features/settings/components/ProfileDetailsScreen.tsx'),
      'utf8'
    );
    // The page background is not the primary button's ink on every palette.
    expect(source).toMatch(/name="mdi:pencil" size=\{16\} color=\{paint\.primary\.content\}/);
  });
});
