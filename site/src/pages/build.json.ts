import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import documents from '../../../copy/legal/documents.json';
import { legalRevisions } from '../legal.mjs';
import copy from '../../../copy/src/site.ts?raw';
import lock from '../../bun.lock?raw';
export const GET: APIRoute = () => new Response(JSON.stringify({
  schemaVersion: 1,
  site: 'sovran-site',
  framework: { name: 'astro', version: '5.18.2' },
  revisions: { ...legalRevisions(documents), siteCopy: createHash('sha256').update(copy).digest('hex'), dependencies: createHash('sha256').update(lock).digest('hex') },
  publicationReady: documents.publicationReady,
  releaseMetadata: 'runtime-only',
  analytics: 'withheld',
}) + '\n', { headers: { 'Content-Type': 'application/json' } });
