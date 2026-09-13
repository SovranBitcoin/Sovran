/**
 * @jest-environment node
 */

/**
 * SYSTEM.md §24: a successful install is not proof the patch landed. Metro
 * resolves heroui-native to `lib/module` (app/metro.config.js), so assert the
 * runtime files carry every sovran hunk; a future bump that silently drops
 * the patch fails here instead of on a device.
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';

const pkgRoot = dirname(require.resolve('heroui-native/package.json'));
const runtime = (rel: string) => readFileSync(resolve(pkgRoot, 'lib', 'module', rel), 'utf8');

describe('heroui-native patch', () => {
  it('forwards mountIndex to gorhom so hosts can mount sheets open', () => {
    const source = runtime('helpers/internal/components/bottom-sheet-content.js');
    expect(source).toContain('index: mountIndex ?? -1');
  });

  it('keeps the nested-scrollable container flags', () => {
    const source = runtime('helpers/internal/components/bottom-sheet-content-container.js');
    expect(source).toContain('useDirectView');
    expect(source).toContain('useScrollableContainer');
  });

  it('hides the toast measurement clone with an inline style', () => {
    const source = runtime('components/toast/toast.js');
    expect(source).toMatch(/position: 'absolute',\s*opacity: 0/);
  });
});
