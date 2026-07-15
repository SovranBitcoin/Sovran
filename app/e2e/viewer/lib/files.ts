import { join } from 'node:path';

import { ARTIFACTS, isValidRunDirName, safeArtifactPath } from './paths';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

function contentTypeFor(path: string): string {
  for (const [ext, type] of Object.entries(CONTENT_TYPES)) {
    if (path.endsWith(ext)) return type;
  }
  return 'application/octet-stream';
}

/** Parse a single-range `bytes=` header against a file size; multi-range and
 * unsatisfiable requests fall back to a full-body response. */
export function parseByteRange(
  header: string,
  size: number
): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return undefined;
  const start = match[1] ? Number(match[1]) : size - Number(match[2]);
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || start < 0 || start > end) return undefined;
  return { start, end };
}

/** Serve one artifact file from inside a run dir. `immutable` should be true
 * for completed runs — their dirs never change, so browsers may cache hard.
 * Honors single-range requests — <video> playback (Safari mandatorily,
 * Chrome for seeking) requires 206 responses. */
export function serveRunFile(
  runDirName: string,
  relPath: string,
  immutable: boolean,
  rangeHeader?: string | null
): Response {
  if (!isValidRunDirName(runDirName)) return new Response('forbidden', { status: 403 });
  const abs = safeArtifactPath(join(ARTIFACTS, runDirName), relPath);
  if (!abs) return new Response('forbidden', { status: 403 });
  const file = Bun.file(abs);
  const headers: Record<string, string> = {
    'content-type': contentTypeFor(abs),
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'accept-ranges': 'bytes',
  };
  const range = rangeHeader ? parseByteRange(rangeHeader, file.size) : undefined;
  if (range) {
    return new Response(file.slice(range.start, range.end + 1), {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${range.start}-${range.end}/${file.size}` },
    });
  }
  return new Response(file, { headers });
}

/** Serve a diff heatmap PNG from the viewer cache. */
export function serveCacheFile(cacheDir: string, relPath: string): Response {
  const abs = safeArtifactPath(cacheDir, relPath);
  if (!abs) return new Response('forbidden', { status: 403 });
  return new Response(Bun.file(abs), {
    headers: { 'content-type': contentTypeFor(abs), 'cache-control': 'no-cache' },
  });
}
