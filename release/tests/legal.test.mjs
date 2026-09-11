import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchingLegalDocuments } from '../legal.mjs';
const approved = { publicationReady: true, operator: { name: 'Operator' }, terms: { text: 'Terms' }, privacy: { text: 'Privacy' } };
test('release requires matching, approved website and bundled policies', () => {
  assertMatchingLegalDocuments(approved, structuredClone(approved));
  for (const field of ['operator', 'terms', 'privacy']) {
    const changed = structuredClone(approved); changed[field] = { changed: true };
    assert.throws(() => assertMatchingLegalDocuments(approved, changed), /matching legal documents/);
  }
  assert.throws(() => assertMatchingLegalDocuments({ ...approved, publicationReady: false }, approved), /not approved/);
  assert.throws(() => assertMatchingLegalDocuments(approved, { ...approved, publicationReady: false }), /not approved/);
});
