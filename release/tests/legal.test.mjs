import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertMatchingLegalDocuments, verifyLegalPublication } from '../legal.mjs';

const bytes = await readFile(new URL('../../copy/legal/documents.json', import.meta.url));
const approved = JSON.parse(bytes);
const currentPath = 'copy/legal/documents.json';
const shippedPath = 'app/shared/lib/legal/documents.json';

test('release requires matching, approved website and bundled policies', () => {
  assertMatchingLegalDocuments(approved, structuredClone(approved));
  for (const field of ['operator', 'terms', 'privacy']) {
    const changed = structuredClone(approved); changed[field][field === 'operator' ? 'name' : 'title'] += ' Changed';
    assert.throws(() => assertMatchingLegalDocuments(approved, changed), /matching legal documents/);
  }
  assert.throws(() => assertMatchingLegalDocuments({ ...approved, publicationReady: false }, approved), /not approved/);
  assert.throws(() => assertMatchingLegalDocuments(approved, { ...approved, publicationReady: false }), /not approved/);
});

test('raw publication without revisions preserves the existing acceptance fingerprints', () => {
  assert.equal(approved.revisions, undefined);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'ffaa48e2e6378c2931605c66ce00c4405aec82f8f96d57cbc08e42b65f4de7d4');
  const revisions = Object.fromEntries(['terms', 'privacy'].map((id) => [id,
    createHash('sha256').update(JSON.stringify({ operator: approved.operator, document: approved[id], publicationReady: approved.publicationReady })).digest('hex'),
  ]));
  assert.deepEqual(revisions, {
    terms: 'f71f7d665b21a0322884c86e548ed4400836a6bf946d3511392bc9c20012f512',
    privacy: '2afbd0f2a5962bb839d7541c88f0e9467fe64718ce422fd2f995fd045a0c3692',
  });
  assertMatchingLegalDocuments(approved, { ...approved, revisions });
  assertMatchingLegalDocuments({ ...approved, revisions }, approved);
});

test('missing and malformed matching fields cannot pass publication validation', () => {
  for (const field of ['operator', 'terms', 'privacy']) {
    for (const value of [undefined, null, {}, [], '', 42]) {
      const malformed = { ...approved, [field]: value };
      assert.throws(() => assertMatchingLegalDocuments(malformed, structuredClone(malformed)), /Malformed legal/);
      assert.throws(() => assertMatchingLegalDocuments(approved, malformed), /Malformed legal/);
    }
  }
  for (const sections of [[], [null], [{ title: 'Section', paragraphs: [] }], [{ title: 'Section', paragraphs: [null] }]]) {
    const malformed = { ...approved, terms: { ...approved.terms, sections } };
    assert.throws(() => assertMatchingLegalDocuments(malformed, malformed), /Malformed legal/);
  }
  for (const value of [undefined, null, {}, [], { publicationReady: true }]) {
    assert.throws(() => assertMatchingLegalDocuments(value, value));
  }
});

test('controller supports current and shipped immutable source layouts with a stubbed download', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sovran-legal-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const network = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://sovran.money/legal/documents.json');
    assert.equal(init.redirect, 'manual');
    return new Response(bytes);
  });
  for (const layout of [currentPath, shippedPath]) {
    const source = path.join(root, layout === currentPath ? 'current' : 'shipped');
    await mkdir(path.dirname(path.join(source, layout)), { recursive: true });
    await writeFile(path.join(source, layout), bytes);
    await verifyLegalPublication(source);
  }
  assert.equal(network.mock.callCount(), 2);

  const source = path.join(root, 'both');
  for (const layout of [currentPath, shippedPath]) {
    await mkdir(path.dirname(path.join(source, layout)), { recursive: true });
    await writeFile(path.join(source, layout), layout === currentPath ? bytes : 'invalid legacy JSON');
  }
  await verifyLegalPublication(source);
  await writeFile(path.join(source, shippedPath), bytes);
  for (const invalid of ['invalid current JSON', '{}', JSON.stringify({ ...approved, terms: {} })]) {
    await writeFile(path.join(source, currentPath), invalid);
    await assert.rejects(verifyLegalPublication(source));
  }
  await rm(path.join(source, currentPath));
  await mkdir(path.join(source, currentPath));
  await assert.rejects(verifyLegalPublication(source), { code: 'EISDIR' });
  await assert.rejects(verifyLegalPublication(path.join(root, 'missing')), { code: 'ENOENT' });
});

test('controller rejects malformed or missing published documents', async (t) => {
  const source = fileURLToPath(new URL('../../', import.meta.url));
  for (const response of ['invalid JSON', '{}', JSON.stringify({ ...approved, privacy: {} })]) {
    const network = t.mock.method(globalThis, 'fetch', async () => new Response(response));
    await assert.rejects(verifyLegalPublication(source));
    network.mock.restore();
  }
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  await assert.rejects(verifyLegalPublication(source));
});
