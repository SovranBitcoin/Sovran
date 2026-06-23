/**
 * Value summarization + secret redaction for the structured logger.
 *
 * Pure functions, no I/O and no logger state: take an arbitrary param value and
 * return a compact, secret-safe representation for the log entry. Long/opaque
 * strings (JWTs, pubkeys, base64, keys) become `{ _kind, len, preview? }`
 * summaries; values whose first bytes could themselves be key material emit
 * `{ _kind, len }` with no preview.
 *
 * SECURITY: this module is the redaction boundary. `summarizeString` and
 * `redactKnownSecretSubstrings` are what keep nsec/xprv/cashu-token/seed
 * material out of the ring buffer and file transport. Changes here are
 * security-sensitive — keep `loggerRedaction.test.ts` / `loggerValueCompact`
 * tests green.
 */

/** Tunables shared by the compacting walk (mirrors the logger's options). */
export interface CompactOpts {
  maxStringLength: number;
  maxArrayItems: number;
  maxDepth: number;
  maxObjectKeys: number;
}

// ─── Value Summarization ─────────────────────────────────────────────────────
//
// Detect known verbose patterns and replace with a compact summary:
//   { _kind: "jwt", len: 512, preview: "eyJhbGciOi…" }

// Secret patterns: a previewed prefix is itself sensitive — emit `_kind, len`
// only. Order: secret patterns run before LONG_STRING_PATTERNS so a string
// matching both is classified as the secret it actually is.
const SECRET_STRING_PATTERNS: { name: string; test: (s: string) => boolean }[] = [
  { name: 'pem_key', test: (s) => s.includes('-----BEGIN') },
  { name: 'jwt', test: (s) => /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s) },
  { name: 'data_uri', test: (s) => /^data:[^;]+;base64,/.test(s) },
  { name: 'connection_str', test: (s) => /^(postgres|mysql|mongodb|redis|wss?):\/\//.test(s) },
  { name: 'nsec', test: (s) => /^nsec1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(s) },
  { name: 'cashu_token', test: (s) => s.startsWith('cashuA') || s.startsWith('cashuB') },
  { name: 'lightning_invoice', test: (s) => /^ln(bc|tb|tbs)[0-9a-z]{50,}/i.test(s) },
  // A bare 32-byte hex string is the secp256k1 private-key length. A private
  // key and a public key / event id are indistinguishable by value (both are
  // 64 hex chars), so we cannot safely preview *any* of them: a 32-char preview
  // would leak half a private key. Classify all 64-char hex as a secret and
  // emit only `{ _kind, len }` (no preview). Deliberately log npubs (which keep
  // their preview) when you need a readable identity in logs. Runs before the
  // base64/hex long-string patterns, which would otherwise preview it.
  { name: 'hex32', test: (s) => /^(0x)?[0-9a-fA-F]{64}$/.test(s) },
  // BIP32 extended PRIVATE keys (xprv/yprv/zprv + testnet tprv/uprv/vprv).
  // base58, ~111 chars — without this they fall through to the base64 long
  // pattern and (being ≤120) get logged in full.
  {
    name: 'xprv',
    test: (s) => /^(xprv|yprv|zprv|tprv|uprv|vprv)[1-9A-HJ-NP-Za-km-z]{100,}$/.test(s),
  },
  // WIF private keys: base58, mainnet 5/K/L, testnet 9/c, 51-52 chars.
  // Otherwise classified as a generic long_string and logged in full.
  { name: 'wif', test: (s) => /^[59cKL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(s) },
  // base64 that decodes to a 32- or 64-byte payload — the size of a private key
  // or seed. Ambiguous (could be a 32-byte hash) but we hide rather than risk
  // leaking key material; the length is still reported via `len`.
  {
    name: 'base64_key',
    test: (s) => /^[A-Za-z0-9+/]{43}={0,1}$|^[A-Za-z0-9+/]{86,88}={0,2}$/.test(s),
  },
];

const EMBEDDED_SECRET_PATTERNS: { replacement: string; pattern: RegExp }[] = [
  {
    replacement: '<REDACTED:nsec>',
    pattern: /\bnsec1[023456789acdefghjklmnpqrstuvwxyz]{58}\b/g,
  },
  {
    replacement: '<REDACTED:xprv>',
    pattern: /\b(xprv|yprv|zprv|tprv|uprv|vprv)[1-9A-HJ-NP-Za-km-z]{100,}/g,
  },
  {
    replacement: '<REDACTED:cashu-token>',
    pattern: /\bcashu[AB][A-Za-z0-9_-]{20,}/g,
  },
  {
    replacement: '<REDACTED:lightning-invoice>',
    pattern: /\bln(bc|tb|tbs)[0-9a-z]{50,}/gi,
  },
  {
    replacement: '<REDACTED:jwt>',
    pattern: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  },
];

// `noPreview` marks opaque encodings whose first 32 chars could themselves be
// key material — emit `{ _kind, len }` only, never the bytes (even when short
// enough to otherwise print in full).
const LONG_STRING_PATTERNS: { name: string; noPreview?: boolean; test: (s: string) => boolean }[] =
  [
    { name: 'npub', test: (s) => /^npub1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(s) },
    { name: 'base64', noPreview: true, test: (s) => /^[A-Za-z0-9+/]{60,}={0,2}$/.test(s) },
    { name: 'hex', noPreview: true, test: (s) => /^(0x)?[0-9a-fA-F]{40,}$/.test(s) },
    {
      name: 'uuid',
      test: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
    },
    { name: 'url', test: (s) => /^https?:\/\/.{80,}/.test(s) },
    { name: 'json_blob', test: (s) => s.length > 200 && (s[0] === '{' || s[0] === '[') },
    { name: 'xml_blob', test: (s) => s.length > 200 && s.trimStart().startsWith('<') },
    // Opaque base58 (>=32 chars): could be a Solana pubkey, a base58-encoded key,
    // or other key material. Indistinguishable by value, so never show the bytes.
    {
      name: 'base58',
      noPreview: true,
      test: (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && s.length >= 32,
    },
  ];

type StringClass =
  | { kind: 'secret'; name: string }
  | { kind: 'long'; name: string; noPreview?: boolean };

function classifyString(s: string): StringClass {
  for (const p of SECRET_STRING_PATTERNS) if (p.test(s)) return { kind: 'secret', name: p.name };
  for (const p of LONG_STRING_PATTERNS)
    if (p.test(s)) return { kind: 'long', name: p.name, noPreview: p.noPreview };
  return { kind: 'long', name: 'long_string' };
}

type Compact = string | { _kind: string; len: number; preview?: string };

export function redactKnownSecretSubstrings(s: string): string {
  let out = s;
  for (const { pattern, replacement } of EMBEDDED_SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function summarizeString(s: string, maxLen: number): Compact {
  const c = classifyString(s);
  if (c.kind === 'secret') return { _kind: c.name, len: s.length };
  const redacted = redactKnownSecretSubstrings(s);
  if (redacted !== s) {
    if (redacted.length <= maxLen) return redacted;
    return { _kind: 'redacted_string', len: s.length, preview: redacted.slice(0, 32) + '…' };
  }
  // Opaque encodings (hex/base64/base58) could be key material — never show
  // their bytes, even when short enough to otherwise print in full.
  if (c.kind === 'long' && c.noPreview) return { _kind: c.name, len: s.length };
  if (s.length <= maxLen) return s;
  return { _kind: c.name, len: s.length, preview: s.slice(0, 32) + '…' };
}

function normalizeFieldName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function sensitiveFieldKind(fieldName: string): string | null {
  const normalized = normalizeFieldName(fieldName);
  if (
    normalized === 'secret' ||
    normalized === 'nsec' ||
    normalized.endsWith('nsec') ||
    normalized === 'privkey' ||
    normalized.endsWith('privatekey') ||
    normalized.endsWith('privatekeyhex') ||
    normalized.endsWith('secretkey') ||
    normalized.endsWith('signerkey')
  ) {
    return 'private_key';
  }
  if (
    normalized === 'mnemonic' ||
    normalized.endsWith('mnemonic') ||
    normalized === 'seed' ||
    normalized.endsWith('seed') ||
    normalized.endsWith('seedhex') ||
    normalized.endsWith('xpriv') ||
    normalized.endsWith('passphrase') ||
    normalized.endsWith('password')
  ) {
    return 'secret';
  }
  if (
    normalized === 'token' ||
    normalized.endsWith('token') ||
    normalized === 'authorization' ||
    normalized.endsWith('authorization')
  ) {
    return 'secret';
  }
  return null;
}

function compactSensitiveField(value: unknown, fieldName: string | undefined): unknown | undefined {
  if (!fieldName) return undefined;
  const kind = sensitiveFieldKind(fieldName);
  if (!kind) return undefined;
  if (typeof value === 'string') {
    const c = classifyString(value);
    // Prefer a specifically branded secret type (nsec/cashu_token/jwt/pem/…)
    // over the field-derived kind. The generic 32-byte-hex secret (`hex32`) is
    // *less* specific than a named field like `privateKeyHex`, so keep the
    // field's kind in that case.
    const useValueName = c.kind === 'secret' && c.name !== 'hex32';
    return { _kind: useValueName ? c.name : kind, len: value.length };
  }
  if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
    return { _kind: kind, bytes: (value as Uint8Array).byteLength };
  }
  if (value === null || value === undefined) return value;
  return { _kind: kind };
}

export function compactValue(
  value: unknown,
  opts: CompactOpts,
  depth: number = 0,
  fieldName?: string
): unknown {
  const sensitive = compactSensitiveField(value, fieldName);
  if (sensitive !== undefined) return sensitive;
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  )
    return value;
  if (typeof value === 'string') return summarizeString(value, opts.maxStringLength);
  if (value instanceof Error) {
    return {
      _kind: 'error',
      name: value.name,
      message: value.message,
      stack: (value.stack ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 10),
    };
  }
  if (value instanceof Date) return { _kind: 'date', iso: value.toISOString() };
  if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)))
    return { _kind: 'buffer', bytes: (value as Uint8Array).byteLength };
  if (value instanceof RegExp) return { _kind: 'regexp', source: value.toString() };
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of value) {
      if (count >= opts.maxObjectKeys) {
        obj[`…${value.size - count}_more`] = true;
        break;
      }
      const entryKey = String(k);
      obj[entryKey] = compactValue(v, opts, depth + 1, entryKey);
      count++;
    }
    return { _kind: 'map', size: value.size, entries: obj };
  }
  if (value instanceof Set) {
    return {
      _kind: 'set',
      size: value.size,
      sample: [...value].slice(0, opts.maxArrayItems).map((v) => compactValue(v, opts, depth + 1)),
    };
  }
  if (Array.isArray(value)) {
    if (depth >= opts.maxDepth) return { _kind: 'array', length: value.length };
    const items = value.slice(0, opts.maxArrayItems).map((v) => compactValue(v, opts, depth + 1));
    if (value.length > opts.maxArrayItems) items.push(`…${value.length - opts.maxArrayItems} more`);
    return items;
  }
  if (typeof value === 'function') return { _kind: 'function', name: value.name || 'anon' };
  if (typeof value === 'object') {
    if (depth >= opts.maxDepth) {
      const keys = Object.keys(value as object);
      return { _kind: 'object', keys: keys.length, sample: keys.slice(0, 8) };
    }
    return compactPlainObject(value as Record<string, unknown>, opts, depth);
  }
  return String(value);
}

function compactPlainObject(
  obj: Record<string, unknown>,
  opts: CompactOpts,
  depth: number
): Record<string, unknown> {
  const keys = Object.keys(obj);
  const result: Record<string, unknown> = {};
  const limit = Math.min(keys.length, opts.maxObjectKeys);
  for (let i = 0; i < limit; i++) {
    result[keys[i]] = compactValue(obj[keys[i]], opts, depth + 1, keys[i]);
  }
  if (keys.length > opts.maxObjectKeys) result[`…${keys.length - opts.maxObjectKeys}_more`] = true;
  return result;
}
