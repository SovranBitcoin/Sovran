/* eslint-disable no-restricted-globals -- standalone browser dev tool; the RN
 * app's fetchJson wrapper (AbortSignal/zod envelopes) doesn't apply here */
import type {
  StoreScreenshotExport,
  ClearResult,
  DiffResult,
  JobStatus,
  PagesIndex,
  RunDetail,
  RunSummary,
  ScenarioCatalogEntry,
  TriggerRequest,
} from '../lib/types';

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `${url}: ${response.status}`);
  return payload;
}

export const api = {
  storeExport: (runId: string) =>
    get<StoreScreenshotExport>(`/api/runs/${runId}/file/store/manifest.json`),
  runs: () => get<RunSummary[]>('/api/runs'),
  run: (runId: string) => get<RunDetail>(`/api/runs/${runId}`),
  scenarios: () => get<ScenarioCatalogEntry[]>('/api/scenarios'),
  pages: (allRuns: boolean) => get<PagesIndex>(`/api/pages${allRuns ? '?all=1' : ''}`),
  runFileUrl: (runId: string, relPath: string) =>
    `/api/runs/${runId}/file/${relPath.split('/').map(encodeURIComponent).join('/')}`,
  diff: (runA: string, runB: string) =>
    post<{ key: string; cached: boolean; jobId?: string }>('/api/diff', { runA, runB }),
  diffResult: async (key: string): Promise<DiffResult | undefined> => {
    const response = await fetch(`/api/diff/${key}`);
    if (response.status === 202) return undefined;
    if (!response.ok) throw new Error(`diff: ${response.status}`);
    return response.json();
  },
  diffImageUrl: (key: string, relPath: string) => `/api/diff/${key}/image/${relPath}`,
  trigger: (request: TriggerRequest) =>
    post<{ jobId: string; argvs: string[][] }>('/api/trigger', request),
  activeJob: () => get<JobStatus | null>('/api/jobs/active'),
  killJob: () => post<{ ok: true; id: string }>('/api/jobs/kill', {}),
  clear: () => post<ClearResult>('/api/clear', { confirm: 'DELETE' }),
  stream: (
    jobId: string,
    handlers: {
      open?: () => void;
      line?: (line: string) => void;
      runDiscovered?: (runId: string) => void;
      progress?: (progress: { done: number; total: number }) => void;
      exit?: (code: number) => void;
    }
  ): EventSource => {
    const source = new EventSource(`/api/jobs/${jobId}/stream`);
    // Fires on every (re)connect. The server replays its full line buffer per
    // connection, so the consumer must reset accumulated lines here or each
    // reconnect (hot reload, dropped socket) duplicates the whole console.
    source.onopen = () => handlers.open?.();
    source.addEventListener('line', (event) =>
      handlers.line?.(JSON.parse((event as MessageEvent).data))
    );
    source.addEventListener('run-discovered', (event) =>
      handlers.runDiscovered?.(JSON.parse((event as MessageEvent).data).runId)
    );
    source.addEventListener('progress', (event) =>
      handlers.progress?.(JSON.parse((event as MessageEvent).data))
    );
    source.addEventListener('exit', (event) => {
      handlers.exit?.(JSON.parse((event as MessageEvent).data).code);
      source.close();
    });
    return source;
  },
};
