import { join } from 'node:path';

import { ARTIFACTS, isValidRunDirName, safeArtifactPath } from './paths';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
};

function contentTypeFor(path: string): string {
  for (const [ext, type] of Object.entries(CONTENT_TYPES)) {
    if (path.endsWith(ext)) return type;
  }
  return 'application/octet-stream';
}

/** Serve one artifact file from inside a run dir. `immutable` should be true
 * for completed runs — their dirs never change, so browsers may cache hard. */
export function serveRunFile(runDirName: string, relPath: string, immutable: boolean): Response {
  if (!isValidRunDirName(runDirName)) return new Response('forbidden', { status: 403 });
  const abs = safeArtifactPath(join(ARTIFACTS, runDirName), relPath);
  if (!abs) return new Response('forbidden', { status: 403 });
  return new Response(Bun.file(abs), {
    headers: {
      'content-type': contentTypeFor(abs),
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    },
  });
}

/** Serve a diff heatmap PNG from the viewer cache. */
export function serveCacheFile(cacheDir: string, relPath: string): Response {
  const abs = safeArtifactPath(cacheDir, relPath);
  if (!abs) return new Response('forbidden', { status: 403 });
  return new Response(Bun.file(abs), {
    headers: { 'content-type': contentTypeFor(abs), 'cache-control': 'no-cache' },
  });
}
