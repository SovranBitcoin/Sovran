/**
 * A mint's NUT-06 `/v1/info` as this phone keeps it: one canonical form, a
 * hash of it, and the invertible RFC 6902 patch between two of them.
 *
 * Canonical: `time` (the mint's clock, different on every call) is dropped,
 * object keys are sorted at every depth, and the lists a mint may send in any
 * order are sorted by what identifies an entry: NUT-04/05 `methods` and
 * NUT-17 `supported` by (method, unit), each NUT-17 entry's `commands`,
 * NUT-19 `cached_endpoints` and NUT-22 `protected_endpoints` by
 * (method, path), `contact` by (method, info) and `urls`. Two answers that
 * differ only in order or clock are the same document, so they never record a
 * revision.
 *
 * Patches are the shape `decode.ts` (`pairPatchOps`) → `interpret.ts` →
 * `groupEntries.ts` already phrase: every `replace` and `remove` is preceded
 * by a `test` carrying the old value, pointers are escaped, and array members
 * are addressed by index (never `-`), so `invertPatch` can walk any revision
 * back without the document it was taken from.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { pairPatchOps, type PatchOp } from './decode';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type CanonicalMintInfo = { [key: string]: Json };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** JSON values only: functions, `undefined`, non-finite numbers and cycles are dropped. */
function toJson(value: unknown, depth: number): Json | undefined {
  if (depth > 32) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value.map((item) => toJson(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (isRecord(value)) {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) {
      const item = toJson(value[key], depth + 1);
      if (item !== undefined) out[key] = item;
    }
    return out;
  }
  return undefined;
}

const str = (value: Json | undefined): string => (typeof value === 'string' ? value : '');

/** Key-sorted JSON text; objects are already key-sorted by `toJson`. */
const text = (value: Json | undefined): string => JSON.stringify(value ?? null);

function sortBy(list: Json, fields: readonly string[]): Json {
  if (!Array.isArray(list)) return list;
  const key = (item: Json) =>
    isRecord(item) ? fields.map((f) => str((item as { [k: string]: Json })[f]).toLowerCase()) : [];
  return [...list].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < fields.length; i++) {
      if (ka[i]! < kb[i]!) return -1;
      if (ka[i]! > kb[i]!) return 1;
    }
    const ta = text(a);
    const tb = text(b);
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}

function sortStrings(list: Json): Json {
  if (!Array.isArray(list)) return list;
  return [...list].sort((a, b) => {
    const ta = text(a);
    const tb = text(b);
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}

function withSorted(
  parent: { [key: string]: Json },
  field: string,
  sort: (value: Json) => Json
): void {
  if (Object.hasOwn(parent, field)) parent[field] = sort(parent[field]!);
}

/**
 * The canonical form of a `/v1/info` answer, or `undefined` when it is not a
 * NUT-06 document at all (not an object, or no string `name`, `pubkey` or
 * `version` where present).
 */
export function canonicalizeMintInfo(raw: unknown): CanonicalMintInfo | undefined {
  if (!isRecord(raw)) return undefined;
  for (const field of ['name', 'pubkey', 'version'] as const) {
    if (raw[field] !== undefined && typeof raw[field] !== 'string') return undefined;
  }
  const doc = toJson(raw, 0);
  if (!isRecord(doc)) return undefined;
  const info = doc as CanonicalMintInfo;
  delete info.time;

  withSorted(info, 'contact', (v) => sortBy(v, ['method', 'info']));
  withSorted(info, 'urls', sortStrings);

  const nuts = info.nuts;
  if (isRecord(nuts)) {
    const n = nuts as { [key: string]: Json };
    for (const nut of ['4', '5']) {
      const entry = n[nut];
      if (isRecord(entry)) {
        withSorted(entry as { [k: string]: Json }, 'methods', (v) => sortBy(v, ['method', 'unit']));
      }
    }
    const n17 = n['17'];
    if (isRecord(n17)) {
      withSorted(n17 as { [k: string]: Json }, 'supported', (v) => {
        if (!Array.isArray(v)) return v;
        const withCommands = v.map((item) => {
          if (!isRecord(item)) return item;
          const copy = { ...(item as { [k: string]: Json }) };
          withSorted(copy, 'commands', sortStrings);
          return copy;
        });
        return sortBy(withCommands, ['method', 'unit']);
      });
    }
    for (const [nut, field] of [
      ['19', 'cached_endpoints'],
      ['22', 'protected_endpoints'],
    ] as const) {
      const entry = n[nut];
      if (isRecord(entry)) {
        withSorted(entry as { [k: string]: Json }, field, (v) => sortBy(v, ['method', 'path']));
      }
    }
  }
  return info;
}

/** The canonical document's identity: SHA-256 of its key-sorted JSON. */
export function hashMintInfo(info: CanonicalMintInfo): string {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(info))));
}

/* ── diff ──────────────────────────────────────────────────────────────── */

const escapeToken = (token: string) => token.replace(/~/g, '~0').replace(/\//g, '~1');
const unescapeToken = (token: string) => token.replace(/~1/g, '/').replace(/~0/g, '~');
const child = (path: string, token: string | number) => `${path}/${escapeToken(String(token))}`;

const same = (a: Json | undefined, b: Json | undefined) => text(a) === text(b);

/** What makes two members of a list the same member, changed or not. */
function identity(item: Json): string {
  if (isRecord(item)) {
    const o = item as { [k: string]: Json };
    if (typeof o.method === 'string' && typeof o.unit === 'string')
      return `mu:${o.method}|${o.unit}`;
    if (typeof o.method === 'string' && typeof o.path === 'string')
      return `mp:${o.method}|${o.path}`;
    if (typeof o.method === 'string' && typeof o.info === 'string')
      return `mi:${o.method}|${o.info}`;
  }
  return `v:${text(item)}`;
}

/** Longest common subsequence of two lists by identity, as index pairs. */
function matchLists(a: Json[], b: Json[]): [number, number][] {
  const ia = a.map(identity);
  const ib = b.map(identity);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] =
        ia[i] === ib[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (ia[i] === ib[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

function diffValue(path: string, a: Json, b: Json, out: PatchOp[]): void {
  if (same(a, b)) return;
  if (isRecord(a) && isRecord(b)) {
    diffObject(path, a as { [k: string]: Json }, b as { [k: string]: Json }, out);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    diffArray(path, a, b, out);
    return;
  }
  out.push({ op: 'test', path, value: a }, { op: 'replace', path, value: b });
}

function diffObject(
  path: string,
  a: { [k: string]: Json },
  b: { [k: string]: Json },
  out: PatchOp[]
): void {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const key of keys) {
    const at = child(path, key);
    const inA = Object.hasOwn(a, key);
    const inB = Object.hasOwn(b, key);
    if (inA && !inB) out.push({ op: 'test', path: at, value: a[key] }, { op: 'remove', path: at });
    else if (!inA && inB) out.push({ op: 'add', path: at, value: b[key] });
    else diffValue(at, a[key]!, b[key]!, out);
  }
}

function diffArray(path: string, a: Json[], b: Json[], out: PatchOp[]): void {
  if (a.length === b.length && a.every((item, i) => identity(item) === identity(b[i]!))) {
    a.forEach((item, i) => diffValue(child(path, i), item, b[i]!, out));
    return;
  }
  const pairs = matchLists(a, b);
  const keptA = new Set(pairs.map(([i]) => i));
  const keptB = new Set(pairs.map(([, j]) => j));
  // Removals from the back so earlier indices hold; then insertions from the
  // front at their final index; then changes inside the members both kept.
  for (let i = a.length - 1; i >= 0; i--) {
    if (!keptA.has(i)) {
      out.push(
        { op: 'test', path: child(path, i), value: a[i] },
        { op: 'remove', path: child(path, i) }
      );
    }
  }
  for (let j = 0; j < b.length; j++) {
    if (!keptB.has(j)) out.push({ op: 'add', path: child(path, j), value: b[j] });
  }
  for (const [i, j] of pairs) diffValue(child(path, j), a[i]!, b[j]!, out);
}

/** The patch that turns `before` into `after`; empty when they are the same document. */
export function diffMintInfo(before: CanonicalMintInfo, after: CanonicalMintInfo): PatchOp[] {
  const out: PatchOp[] = [];
  diffObject('', before, after, out);
  return out;
}

/* ── apply / invert ────────────────────────────────────────────────────── */

function clone<T extends Json>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Apply a patch to a copy of `doc`. Throws when a `test` fails or a path does
 * not resolve: a patch that does not fit is a revision this phone cannot
 * replay, never one to guess at.
 */
export function applyMintInfoPatch(
  doc: CanonicalMintInfo,
  patch: readonly PatchOp[]
): CanonicalMintInfo {
  const root = clone(doc) as Json;
  for (const op of patch) {
    const tokens = op.path.split('/').slice(1).map(unescapeToken);
    if (tokens.length === 0) throw new Error('patch targets the whole document');
    let parent: Json = root;
    for (const token of tokens.slice(0, -1)) {
      const next: Json | undefined = Array.isArray(parent)
        ? parent[Number(token)]
        : isRecord(parent)
          ? (parent as { [k: string]: Json })[token]
          : undefined;
      if (next === undefined) throw new Error(`no ${op.path}`);
      parent = next;
    }
    const last = tokens[tokens.length - 1]!;
    const value = op.value as Json;
    if (Array.isArray(parent)) {
      const index = last === '-' ? parent.length : Number(last);
      if (!Number.isInteger(index) || index < 0 || index > parent.length)
        throw new Error(`bad ${op.path}`);
      if (op.op === 'test') {
        if (!same(parent[index], value)) throw new Error(`test failed at ${op.path}`);
      } else if (op.op === 'add') parent.splice(index, 0, clone(value));
      else if (op.op === 'remove') parent.splice(index, 1);
      else if (op.op === 'replace') parent[index] = clone(value);
      else throw new Error(`unsupported op ${op.op}`);
    } else if (isRecord(parent)) {
      const obj = parent as { [k: string]: Json };
      if (op.op === 'test') {
        if (!same(obj[last], value)) throw new Error(`test failed at ${op.path}`);
      } else if (op.op === 'add' || op.op === 'replace') obj[last] = clone(value);
      else if (op.op === 'remove') delete obj[last];
      else throw new Error(`unsupported op ${op.op}`);
    } else {
      throw new Error(`no ${op.path}`);
    }
  }
  return root as CanonicalMintInfo;
}

/** The patch that undoes `patch`: from its result back to the document it was taken from. */
export function invertPatch(patch: readonly PatchOp[]): PatchOp[] {
  const out: PatchOp[] = [];
  for (const op of pairPatchOps(patch).reverse()) {
    if (op.op === 'add') {
      out.push({ op: 'test', path: op.path, value: op.value }, { op: 'remove', path: op.path });
    } else if (op.op === 'remove' && op.hadBefore) {
      out.push({ op: 'add', path: op.path, value: op.before });
    } else if (op.op === 'replace' && op.hadBefore) {
      out.push(
        { op: 'test', path: op.path, value: op.value },
        { op: 'replace', path: op.path, value: op.before }
      );
    } else {
      throw new Error(`cannot invert ${op.op} at ${op.path}`);
    }
  }
  return out;
}
