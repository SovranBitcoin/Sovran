import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { check, download } from './core.mjs';

export function assertMatchingLegalDocuments(bundled, published) {
  check(bundled?.publicationReady === true && published?.publicationReady === true, 'Legal documents are not approved for publication');
  const text = (value) => typeof value === 'string' && value.trim().length > 0;
  for (const source of [bundled, published]) {
    check(['name', 'country', 'address', 'email'].every((key) => text(source.operator?.[key])) && source.operator.email.includes('@'), 'Malformed legal operator');
    for (const id of ['terms', 'privacy']) {
      const document = source[id];
      check(document && ['title', 'updated', 'summary'].every((key) => text(document[key])) &&
        Array.isArray(document.sections) && document.sections.length > 0 &&
        document.sections.every((section) => text(section?.title) && Array.isArray(section.paragraphs) &&
          section.paragraphs.length > 0 && section.paragraphs.every(text)), 'Malformed legal document');
    }
  }
  for (const key of ['operator', 'terms', 'privacy']) {
    check(JSON.stringify(bundled[key]) === JSON.stringify(published[key]), 'Publish the matching legal documents on sovran.money before building this release');
  }
}

export async function verifyLegalPublication(sourceDirectory) {
  let bytes;
  try {
    bytes = await readFile(path.join(sourceDirectory, 'copy/legal/documents.json'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // The active controller also builds shipped, immutable source SHAs predating copy/.
    bytes = await readFile(path.join(sourceDirectory, 'app/shared/lib/legal/documents.json'), 'utf8');
  }
  const bundled = JSON.parse(bytes);
  const published = JSON.parse(await download('https://sovran.money/legal/documents.json', ['sovran.money'], 100_000));
  assertMatchingLegalDocuments(bundled, published);
}
