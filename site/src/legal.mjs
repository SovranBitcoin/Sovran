import { createHash } from 'node:crypto';

// Keep the app's acceptance serialization, including property order.
export function legalRevisions(documents) {
  return Object.fromEntries(['terms', 'privacy'].map((id) => [id,
    createHash('sha256').update(JSON.stringify({
      operator: documents.operator,
      document: documents[id],
      publicationReady: documents.publicationReady,
    })).digest('hex'),
  ]));
}
