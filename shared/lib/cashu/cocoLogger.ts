/**
 * Structured logger for coco-core that emits JSON into the app's ring buffer.
 *
 * Replaces ConsoleLogger so coco's internal logs (MintService, ProofService,
 * SubscriptionManager, etc.) appear alongside app logs in dumpForLLM() and
 * are analyzable by log-doctor's coco mode.
 *
 * Design choices:
 * - Event name encodes module + message key, so `msg` is NOT duplicated in params.
 * - `child()` preserves the full module chain: `manager.MintService.RequestRateLimiter`.
 * - Key identifiers (mintUrl, operationId, etc.) from bindings are hoisted into every log entry.
 * - Meta objects are flattened into params and Cashu-specific secrets are compacted before emission.
 */

import { cashuLog } from '../logger';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';
type SanitizedRecord = Record<string, unknown>;

interface Logger {
  error(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
  log?(level: LogLevel, message: string, ...meta: unknown[]): void;
  child?(bindings: Record<string, unknown>): Logger;
}

/** Extract the first plain object from variadic meta args. */
function flattenMeta(meta: unknown[]): SanitizedRecord | undefined {
  if (meta.length === 0) return undefined;
  if (
    meta.length === 1 &&
    typeof meta[0] === 'object' &&
    meta[0] !== null &&
    !Array.isArray(meta[0])
  ) {
    return meta[0] as Record<string, unknown>;
  }
  return { args: meta };
}

function normalizeFieldName(fieldName: string): string {
  return fieldName.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function secretStringKind(value: string): string | null {
  if (value.startsWith('cashuA') || value.startsWith('cashuB')) return 'cashu_token';
  if (/^ln(bc|tb|tbs)[0-9a-z]{50,}/i.test(value)) return 'lightning_invoice';
  if (/^nsec1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(value)) return 'nsec';
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(value)) return 'hex32';
  return null;
}

function redactEmbeddedSecrets(value: string): string {
  return value
    .replace(/\bcashu[AB][A-Za-z0-9_-]{20,}/g, '<REDACTED:cashu-token>')
    .replace(/\bln(bc|tb|tbs)[0-9a-z]{50,}/gi, '<REDACTED:lightning-invoice>')
    .replace(/\bnsec1[023456789acdefghjklmnpqrstuvwxyz]{58}\b/g, '<REDACTED:nsec>');
}

function isSensitiveField(fieldName: string | undefined): boolean {
  if (!fieldName) return false;
  const normalized = normalizeFieldName(fieldName);
  return (
    normalized === 'token' ||
    normalized.endsWith('token') ||
    normalized === 'proof' ||
    normalized.endsWith('proof') ||
    normalized === 'proofs' ||
    normalized.endsWith('proofs') ||
    normalized === 'secret' ||
    normalized === 'secrets' ||
    normalized.endsWith('secret') ||
    normalized.endsWith('secretkey') ||
    normalized.endsWith('secretkeys') ||
    normalized.endsWith('privatekey') ||
    normalized.endsWith('privatekeys') ||
    normalized === 'nsec' ||
    normalized.endsWith('nsec') ||
    normalized === 'mnemonic' ||
    normalized.endsWith('mnemonic') ||
    normalized === 'seed' ||
    normalized.endsWith('seed') ||
    normalized === 'signature' ||
    normalized === 'signatures' ||
    normalized.endsWith('signature') ||
    normalized.endsWith('signatures') ||
    normalized === 'preimage' ||
    normalized === 'preimages' ||
    normalized.endsWith('preimage') ||
    normalized.endsWith('preimages') ||
    normalized === 'invoice' ||
    normalized.endsWith('invoice') ||
    normalized === 'bolt11' ||
    normalized.endsWith('bolt11')
  );
}

function isMintUrlField(fieldName: string | undefined): boolean {
  if (!fieldName) return false;
  const normalized = normalizeFieldName(fieldName);
  return normalized === 'minturl' || normalized.endsWith('minturl');
}

function summarizeMintUrl(value: string): SanitizedRecord {
  try {
    return { _kind: 'mint_url', host: new URL(value).host, len: value.length };
  } catch {
    return { _kind: 'mint_url', len: value.length };
  }
}

function summarizeObject(value: Record<string, unknown>): SanitizedRecord {
  return {
    _kind: 'object',
    keys: Object.keys(value).slice(0, 12),
    keyCount: Object.keys(value).length,
  };
}

function sanitizeValue(value: unknown, fieldName?: string, depth: number = 0): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    if (isMintUrlField(fieldName)) return summarizeMintUrl(value);
    const secretKind = secretStringKind(value);
    if (secretKind || isSensitiveField(fieldName)) {
      return { _kind: secretKind ?? 'secret', len: value.length };
    }
    const redacted = redactEmbeddedSecrets(value);
    if (redacted !== value) return redacted;
    if (value.length > 120)
      return { _kind: 'string', len: value.length, preview: value.slice(0, 32) };
    return value;
  }
  if (value instanceof Error) {
    return {
      _kind: 'error',
      name: value.name,
      message: redactEmbeddedSecrets(value.message),
    };
  }
  if (value instanceof Uint8Array) {
    return {
      _kind: isSensitiveField(fieldName) ? 'secret_bytes' : 'bytes',
      bytes: value.byteLength,
    };
  }
  if (Array.isArray(value)) {
    if (isSensitiveField(fieldName)) return { _kind: 'sensitive_array', len: value.length };
    if (depth >= 2) return { _kind: 'array', len: value.length };
    return {
      _kind: 'array',
      len: value.length,
      sample: value.slice(0, 3).map((item) => sanitizeValue(item, fieldName, depth + 1)),
    };
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (isSensitiveField(fieldName)) return summarizeObject(record);
    if (depth >= 2) return summarizeObject(record);
    return sanitizeRecord(record, depth + 1);
  }
  return String(value);
}

function sanitizeRecord(
  record: SanitizedRecord | undefined,
  depth: number = 0
): SanitizedRecord | undefined {
  if (!record) return undefined;
  const entries = Object.entries(record);
  if (entries.length === 0) return undefined;
  const sanitized: SanitizedRecord = {};
  for (const [key, value] of entries) {
    sanitized[key] = sanitizeValue(value, key, depth);
  }
  return sanitized;
}

/** Convert "Fetching mint info" → "fetching_mint_info" */
function eventKey(message: string): string {
  const secretKind = secretStringKind(message);
  if (secretKind) return `redacted_${secretKind}`;
  const key = redactEmbeddedSecrets(message)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 50);
  return key || 'message';
}

export class CocoCoreLogger implements Logger {
  /** Dot-joined module chain, e.g. "manager.MintService.RequestRateLimiter" */
  private modulePath: string;
  /** Sticky bindings from child() — mintUrl, operationId, etc. */
  private bindings: Record<string, unknown>;

  constructor(modulePath: string = 'coco', bindings: Record<string, unknown> = {}) {
    this.modulePath = modulePath;
    this.bindings = bindings;
  }

  private _emit(level: LogLevel, message: string, meta: unknown[]): void {
    const event = `coco.${this.modulePath}.${eventKey(message)}`;
    const metaObj = flattenMeta(meta);
    const safeBindings = sanitizeRecord(this.bindings);
    const safeMeta = sanitizeRecord(metaObj);
    // Merge bindings + meta. Bindings (mintUrl, etc.) go first so meta can override.
    const params: Record<string, unknown> | undefined =
      safeBindings || safeMeta ? { ...(safeBindings ?? {}), ...(safeMeta ?? {}) } : undefined;
    cashuLog[level](event, params);
  }

  error(message: string, ...meta: unknown[]): void {
    this._emit('error', message, meta);
  }
  warn(message: string, ...meta: unknown[]): void {
    this._emit('warn', message, meta);
  }
  info(message: string, ...meta: unknown[]): void {
    this._emit('info', message, meta);
  }
  debug(message: string, ...meta: unknown[]): void {
    this._emit('debug', message, meta);
  }

  log(level: LogLevel, message: string, ...meta: unknown[]): void {
    this._emit(level, message, meta);
  }

  child(newBindings: Record<string, unknown>): Logger {
    // Build the module chain: if the child has a `module` key, append it to the path.
    const childModule = newBindings.module ? String(newBindings.module) : undefined;
    const nextPath = childModule ? `${this.modulePath}.${childModule}` : this.modulePath;

    // Hoist all non-module bindings (mintUrl, operationId, etc.) as sticky params.
    const { module: _, ...rest } = newBindings;
    const mergedBindings = { ...this.bindings, ...rest };

    return new CocoCoreLogger(nextPath, mergedBindings);
  }
}
