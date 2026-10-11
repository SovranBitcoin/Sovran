/**
 * @jest-environment node
 *
 * The persistence documents name every Coco storage version that shipped: one
 * per wallet database in `cocoDatabases/manifest.json`. A release that changes
 * the Coco version adds a database there (the upgrade test fails until it
 * does), and this fails until the documents say so too.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import manifest from './cocoDatabases/manifest.json';

const DOCS = join(__dirname, '..', '..', 'docs', 'architecture', 'persistence');

it.each(['persistence-map.md', 'evidence-ledger.md'])('%s names every Coco version', (file) => {
  const text = readFileSync(join(DOCS, file), 'utf8');
  const missing = manifest
    .map((entry) => entry.version)
    // A version must not be found inside a longer one: `1.0.0` is not `1.0.0-rc.5`.
    .filter(
      (version) =>
        !new RegExp(
          `(^|[^0-9A-Za-z.-])${version.replace(/\./g, '\\.')}([^0-9A-Za-z.-]|$)`,
          'm'
        ).test(text)
    );
  expect(missing).toEqual([]);
});
