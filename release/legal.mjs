import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { check, download } from './core.mjs';

export function assertMatchingLegalDocuments(bundled, published) {
  check(bundled.publicationReady === true && published.publicationReady === true, 'Legal documents are not approved for publication');
  for (const key of ['operator', 'terms', 'privacy']) {
    check(JSON.stringify(bundled[key]) === JSON.stringify(published[key]), 'Publish the matching legal documents on sovran.money before building this release');
  }
}

export async function verifyLegalPublication(sourceDirectory) {
  const bundled = JSON.parse(await readFile(path.join(sourceDirectory, 'app/shared/lib/legal/documents.json'), 'utf8'));
  const published = JSON.parse(await download('https://sovran.money/legal/documents.json', ['sovran.money'], 100_000));
  assertMatchingLegalDocuments(bundled, published);
}
