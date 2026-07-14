#!/usr/bin/env bun
/* eslint-disable no-console -- dev-tool server boundary */
/** Local viewer for e2e run artifacts. Screenshots are owner-private and
 * unredacted — this server must only ever bind loopback. */
import index from './index.html';
import { buildCatalog } from './lib/catalog';
import { clearRuns } from './lib/clear';
import { computeDiff, diffCacheDir, diffKey } from './lib/diff';
import { serveCacheFile, serveRunFile } from './lib/files';
import {
  activeJob,
  buildRunArgv,
  getJob,
  jobStream,
  killActiveJob,
  startDiffJob,
  startRunJob,
} from './lib/jobs';
import { buildPagesIndex } from './lib/pages';
import { getRunDetail, listRuns, toSummary } from './lib/scan';
import type { TriggerRequest } from './lib/types';

const PORT = Number(process.env.E2E_VIEWER_PORT ?? 4700);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  idleTimeout: 120,
  routes: {
    '/': index,

    '/api/runs': async () => json((await listRuns()).map(toSummary)),

    '/api/runs/:runId': async (req) => {
      const detail = await getRunDetail(req.params.runId);
      return detail ? json(detail) : json({ error: 'unknown run' }, 404);
    },

    '/api/runs/:runId/file/*': async (req) => {
      const detail = await getRunDetail(req.params.runId);
      const relPath = decodeURIComponent(new URL(req.url).pathname.split('/file/')[1] ?? '');
      return serveRunFile(req.params.runId, relPath, detail?.status === 'complete');
    },

    '/api/scenarios': async () => json(await buildCatalog()),

    '/api/pages': async (req) =>
      json(await buildPagesIndex(new URL(req.url).searchParams.get('all') === '1')),

    '/api/diff': {
      POST: async (req) => {
        const body = (await req.json().catch(() => ({}))) as { runA?: string; runB?: string };
        if (!body.runA || !body.runB || body.runA === body.runB)
          return json({ error: 'pick two different runs' }, 400);
        const key = diffKey(body.runA, body.runB);
        if (await Bun.file(`${diffCacheDir(key)}/result.json`).exists())
          return json({ key, cached: true });
        const job = startDiffJob(async (onProgress) => {
          const result = await computeDiff(body.runA!, body.runB!, onProgress);
          if ('error' in result) throw new Error(result.error);
        });
        if ('error' in job) return json(job, 409);
        return json({ key, cached: false, jobId: job.id });
      },
    },

    '/api/diff/:key': async (req) => {
      const file = Bun.file(`${diffCacheDir(req.params.key)}/result.json`);
      if (await file.exists()) return json(JSON.parse(await file.text()));
      const job = activeJob();
      if (job?.kind === 'diff') return json({ status: 'computing', progress: job.progress }, 202);
      return json({ error: 'diff not computed' }, 404);
    },

    '/api/diff/:key/image/*': (req) => {
      const relPath = decodeURIComponent(new URL(req.url).pathname.split('/image/')[1] ?? '');
      return serveCacheFile(diffCacheDir(req.params.key), relPath);
    },

    '/api/trigger': {
      POST: async (req) => {
        const request = (await req.json().catch(() => undefined)) as TriggerRequest | undefined;
        if (!request || !['scenario', 'suite', 'commit-run'].includes(request.kind))
          return json({ error: 'bad trigger request' }, 400);
        const catalog = await buildCatalog();
        const known = new Set(catalog.map((entry) => entry.id));
        const funded = new Set(
          catalog.filter((entry) => entry.lane === 'funded').map((entry) => entry.id)
        );
        const built = buildRunArgv(request, funded, known);
        if ('error' in built) return json(built, 400);
        const job = startRunJob(built.argv);
        if ('error' in job) return json(job, 409);
        return json({ jobId: job.id, argv: built.argv });
      },
    },

    '/api/jobs/active': () => json(activeJob() ?? null),

    '/api/jobs/kill': {
      POST: () => {
        const result = killActiveJob();
        return 'error' in result ? json(result, 409) : json(result);
      },
    },

    '/api/jobs/:id': (req) => {
      const job = getJob(req.params.id);
      return job ? json(job) : json({ error: 'unknown job' }, 404);
    },

    '/api/jobs/:id/stream': (req) =>
      jobStream(req.params.id) ?? json({ error: 'unknown job' }, 404),

    '/api/clear': {
      POST: async (req) => {
        const body = (await req.json().catch(() => ({}))) as { confirm?: string };
        if (body.confirm !== 'DELETE') return json({ error: 'confirmation required' }, 400);
        if (activeJob()) return json({ error: 'a job is running' }, 409);
        return json(await clearRuns());
      },
    },
  },
  fetch() {
    return json({ error: 'not found' }, 404);
  },
});

console.log(`e2e viewer: http://127.0.0.1:${server.port}`);
