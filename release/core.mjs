import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url)));
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export class ReleaseError extends Error {}
export function check(condition, code) { if (!condition) throw new ReleaseError(code); }
export function required(name) { const value = process.env[name]; check(value, `Missing ${name}`); return value; }
function version(value) { check(typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value), 'Invalid product version'); return value; }
export function compareVersion(a, b) {
  const left = version(a).split('.').map(BigInt), right = version(b).split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export function identifier(value) { check(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value), 'Invalid provider identifier'); return value; }
export function uuid(value) { check(typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value), 'Invalid UUID'); return value; }
export function fingerprint(value) { const result = String(value ?? '').replaceAll(':', '').toLowerCase(); check(/^[a-f\d]{64}$/.test(result), 'Configure ANDROID_CERT_SHA256 from Play app signing certificate'); return result; }
export function safeUrl(value, hosts) {
  const u = new URL(value);
  check(u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash && hosts.includes(u.hostname), 'Unapproved remote URL');
  return u;
}

// No provider bodies, URLs, subprocess stderr or raw exceptions in logs: these
// can contain tokens, signed artifact URLs, private metadata or workflow commands.
export class HttpError extends Error { constructor(status) { super(`Provider HTTP ${status}`); this.status = status; } }
export async function request(url, { hosts, token, method = 'GET', body, bytes, limit = 8 * 1024 * 1024, type = 'application/json', accept = 'application/json' } = {}) {
  safeUrl(url, hosts);
  const headers = { Accept: accept, 'User-Agent': 'sovran-release' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || bytes !== undefined) headers['Content-Type'] = type;
  let response;
  try {
    response = await fetch(url, { method, headers, redirect: 'error', signal: AbortSignal.timeout(300_000), body: bytes ?? (body === undefined ? undefined : JSON.stringify(body)) });
    if (!response.ok) throw new HttpError(response.status);
    const parts = []; let size = 0;
    for await (const chunk of response.body ?? []) { size += chunk.length; check(size <= limit, 'Provider response too large'); parts.push(chunk); }
    const data = Buffer.concat(parts);
    return type === 'application/json' ? (data.length ? JSON.parse(data.toString()) : null) : data;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new Error('Provider response failed validation or timed out');
  }
}
export function command(binary, args, options = {}) {
  try { return execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000, maxBuffer: 16 * 1024 * 1024, ...options }); }
  catch { throw new Error(`Command failed: ${path.basename(binary)} (output suppressed)`); }
}
export async function temporary(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sovran-release-'));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Only unauthenticated artifact downloads may redirect. Never forward an API
// credential to object storage. Every hop is checked, including the final URL.
export async function download(url, hosts, limit = 1_000_000_000) {
  for (let hop = 0; hop < 5; hop++) {
    safeUrl(url, hosts);
    let response;
    try { response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(300_000) }); }
    catch { throw new Error('Artifact download failed'); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      check(location, 'Artifact redirect missing destination'); url = new URL(location, url).href; continue;
    }
    if (!response.ok) throw new HttpError(response.status);
    const parts = []; let size = 0;
    try { for await (const chunk of response.body ?? []) { size += chunk.length; check(size <= limit, 'Artifact exceeds size limit'); parts.push(chunk); } }
    catch { throw new Error('Artifact download incomplete or oversized'); }
    return Buffer.concat(parts);
  }
  throw new Error('Too many artifact redirects');
}
export function artifactHosts() {
  // Exact hostnames are deployment configuration, never derived from the URL.
  const hosts = required('ARTIFACT_DOWNLOAD_HOSTS').split(',').map((host) => host.trim());
  check(hosts.length > 0 && hosts.every((host) => /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)), 'Artifact hosts must be exact public DNS hostnames');
  return [...new Set(hosts)];
}

export class GitHub {
  constructor(token, repository = config.repository) { this.token = token; this.repository = repository; }
  async api(route, options = {}) { return request(`https://api.github.com/repos/${this.repository}/${route}`, { hosts: ['api.github.com'], token: this.token, ...options }); }
  async optional(route, options) { try { return await this.api(route, options); } catch (e) { if (e.status === 404) return null; throw e; } }
  async file(file, ref = 'main') {
    const result = await this.optional(`contents/${file}?ref=${encodeURIComponent(ref)}`, { accept: 'application/vnd.github.object+json' });
    if (!result) return null;
    check(result.type === 'file' && /^[a-f\d]{40}$/.test(result.sha), 'Unsupported GitHub file');
    // Contents omits bytes above 1 MB; a large ADP inventory still must resume.
    const blob = result.encoding === 'none' ? await this.api(`git/blobs/${result.sha}`) : result;
    check(blob.encoding === 'base64' && blob.sha === result.sha, 'Unsupported GitHub blob');
    return { sha: result.sha, bytes: Buffer.from(blob.content, 'base64') };
  }
  async put(file, bytes, branch, previousSha, message) {
    return this.api(`contents/${file}`, { method: 'PUT', body: { branch, message, content: Buffer.from(bytes).toString('base64'), ...(previousSha ? { sha: previousSha } : {}) } });
  }
  async pages(route) {
    const results = [];
    for (let page = 1; page <= 100; page++) {
      const items = await this.api(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      check(Array.isArray(items), 'Expected paginated array'); results.push(...items);
      if (items.length < 100) return results;
    }
    throw new Error('Pagination limit exceeded');
  }
}

export class Ledger {
  constructor(gh) { this.gh = gh; }
  async load() {
    const file = await this.gh.file('active.json', config.stateBranch);
    this.sha = file?.sha;
    this.bytes = file?.bytes;
    this.state = file ? JSON.parse(file.bytes) : null;
    if (this.state) {
      check(this.state.schema === 1 && /^[a-f\d]{40}$/.test(this.state.sourceSha), 'Invalid release state'); version(this.state.version);
    }
    return this.state;
  }
  async save() {
    const bytes = JSON.stringify(this.state, null, 2) + '\n';
    if (this.bytes?.equals(Buffer.from(bytes))) return;
    const result = await this.gh.put('active.json', bytes, config.stateBranch, this.sha, `chore: checkpoint release ${this.state.version}`);
    this.sha = result.content.sha;
    this.bytes = Buffer.from(bytes);
  }
  async intent(name) {
    if (this.state.intents[name]) return false;
    this.state.intents[name] = new Date().toISOString();
    await this.save(); // Write ahead of non-idempotent provider requests.
    return true;
  }
}
export function published(state, channel, build, url, extra = {}) {
  const old = state.channels?.[channel];
  if (old?.version === state.version) {
    check(old.build === String(build) && old.url === url && old.sourceSha === state.sourceSha && Object.entries(extra).every(([key, value]) => old[key] === value), 'Published channel identity changed');
    return old;
  }
  return { version: state.version, build: String(build), url, sourceSha: state.sourceSha, confirmedAt: new Date().toISOString(), ...extra };
}
export function output(name, value) {
  check(/^[a-z_]+$/.test(name) && !String(value).includes('\n'), 'Invalid action output');
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, { flag: 'a' });
}
