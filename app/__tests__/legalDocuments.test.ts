import { createHash } from 'node:crypto';
import { legalDocuments, legalRevision, legalRevisions } from '@/shared/lib/legal/legalDocuments';

describe('legal content identity', () => {
  it.each(['terms', 'privacy'] as const)(
    'fingerprints the entire %s document and operator',
    (id) => {
      const document = legalDocuments[id];
      const expected = createHash('sha256')
        .update(
          JSON.stringify({
            operator: legalDocuments.operator,
            document,
            publicationReady: legalDocuments.publicationReady,
          })
        )
        .digest('hex');
      expect(legalRevisions[id]).toBe(expected);
      const changed = structuredClone(document);
      changed.sections[0].paragraphs[0] += ' Changed.';
      expect(legalRevision(changed)).not.toBe(expected);
      expect(
        legalRevision(document, { ...legalDocuments.operator, email: 'new@example.com' })
      ).not.toBe(expected);
    }
  );
});
