/**
 * @jest-environment node
 */

import fs from 'node:fs';
import path from 'node:path';

import { DESIGN_SYSTEM_CATALOG } from '@/features/settings/design-system/catalog';

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: string | readonly string[]) =>
    typeof token === 'string' ? 'mock-theme-color' : token.map(() => 'mock-theme-color'),
}));

jest.mock('@/shared/lib/logger', () => {
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  };

  return {
    feedLog: logger,
    redactError: (error: unknown) => error,
    storeLog: logger,
  };
});

jest.mock('@monicon/native', () => ({
  Monicon: () => null,
}));

function walkTsxFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];

  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return walkTsxFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [absolute] : [];
  });
}

function relativeToApp(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

function componentSources(): string[] {
  const shared = [
    ...walkTsxFiles(path.join(process.cwd(), 'shared/blocks')),
    ...walkTsxFiles(path.join(process.cwd(), 'shared/ui')),
  ];
  const featureRoot = path.join(process.cwd(), 'features');
  const featureComponents = fs
    .readdirSync(featureRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => walkTsxFiles(path.join(featureRoot, entry.name, 'components')));

  return [...shared, ...featureComponents].map(relativeToApp).sort();
}

describe('Design System component inventory', () => {
  const families = DESIGN_SYSTEM_CATALOG;
  const scenarios = families.flatMap((family) => family.scenarios);
  const sources = componentSources();
  const covered = [...new Set(scenarios.flatMap((scenario) => scenario.covers))].sort();

  it('uses stable unique family, route, and per-family scenario identifiers', () => {
    expect(new Set(families.map((family) => family.id)).size).toBe(families.length);
    expect(new Set(families.map((family) => String(family.href))).size).toBe(families.length);

    families.forEach((family) => {
      const scenarioIds = family.scenarios.map((scenario) => scenario.id);
      expect(new Set(scenarioIds).size).toBe(scenarioIds.length);
    });
  });

  it('references only real component source files', () => {
    expect(covered.filter((source) => !sources.includes(source))).toEqual([]);
  });

  it('tracks the complete reusable component surface', () => {
    const pending = sources.filter((source) => !covered.includes(source));

    expect({
      total: sources.length,
      covered,
      pending,
    }).toMatchSnapshot();
  });
});
