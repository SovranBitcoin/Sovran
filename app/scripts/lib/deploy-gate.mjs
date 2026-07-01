/**
 * Deploy readiness gate.
 *
 * sovran.money serves an SPA fallback that returns `200 text/html` for missing
 * files, so a bare status check is not enough — a missing manifest.json looks
 * "OK". Readiness therefore also asserts content-type (and, for the manifest,
 * the byte length matching the local file). The classification is pure.
 */

import { HTTP_USER_AGENT, DEPLOY_POLL_INTERVAL_MS, DEPLOY_TIMEOUT_MS } from '../release.config.mjs';

/**
 * Decide if a fetched URL is the real asset (not the SPA fallback). Pure.
 *
 * @param {object} probe
 * @param {number} probe.status
 * @param {string} probe.contentType
 * @param {number} [probe.bytes]          actual bytes served
 * @param {'image'|'json'} kind
 * @param {number} [expectedBytes]        for kind=json, the local file size
 */
export function isReady({ status, contentType, bytes }, kind, expectedBytes) {
  if (status !== 200) return false;
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('text/html')) return false; // SPA fallback
  if (kind === 'image') return ct.includes('image/');
  if (kind === 'json') {
    if (!ct.includes('json')) return false;
    if (expectedBytes != null && bytes != null) return bytes === expectedBytes;
    return true;
  }
  return false;
}

/** GET a URL and report status/content-type/bytes. */
export async function probe(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': HTTP_USER_AGENT } });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      bytes: buf.length,
    };
  } catch (e) {
    return { status: 0, contentType: '', bytes: 0, error: e.message };
  }
}

/**
 * Poll a set of targets until all are ready or timeout.
 * @param {{url:string, kind:'image'|'json', expectedBytes?:number, label:string}[]} targets
 */
export async function waitForDeploy(
  targets,
  { onTick, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}
) {
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const results = await Promise.all(
      targets.map(async (t) => ({ t, ready: isReady(await probe(t.url), t.kind, t.expectedBytes) }))
    );
    onTick?.(results);
    if (results.every((r) => r.ready)) return true;
    await sleep(DEPLOY_POLL_INTERVAL_MS);
  }
  return false;
}
