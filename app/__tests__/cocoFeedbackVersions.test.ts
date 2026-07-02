/**
 * @jest-environment node
 *
 * COCO_VERSIONS is a hardcoded copy of the package.json pins (Metro cannot
 * bundle dynamic require and coco's exports map hides package.json, so the
 * feedback layer can't resolve versions at runtime). This guard fails the
 * suite if a dependency bump forgets to update the copy — a feedback report
 * with the wrong version would mislead the coco maintainers.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { COCO_VERSIONS } from '@/shared/lib/cashu/cocoFeedback';

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as {
  dependencies: Record<string, string>;
};

describe('coco feedback version pins', () => {
  it.each([
    ['@cashu/coco-core', COCO_VERSIONS.cocoCore],
    ['@cashu/coco-react', COCO_VERSIONS.cocoReact],
    ['@cashu/coco-expo-sqlite', COCO_VERSIONS.cocoExpoSqlite],
    ['@cashu/cashu-ts', COCO_VERSIONS.cashuTs],
  ])('%s pin matches package.json', (dependency, reported) => {
    expect(pkg.dependencies[dependency]).toBe(reported);
  });
});
