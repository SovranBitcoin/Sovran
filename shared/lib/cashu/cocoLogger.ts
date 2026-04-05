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
 * - Meta objects are flattened into params — our ring buffer compacts large values automatically.
 */

import { cashuLog } from '../logger';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface Logger {
  error(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
  log?(level: LogLevel, message: string, ...meta: unknown[]): void;
  child?(bindings: Record<string, unknown>): Logger;
}

/** Extract the first plain object from variadic meta args. */
function flattenMeta(meta: unknown[]): Record<string, unknown> | undefined {
  if (meta.length === 0) return undefined;
  if (meta.length === 1 && typeof meta[0] === 'object' && meta[0] !== null && !Array.isArray(meta[0])) {
    return meta[0] as Record<string, unknown>;
  }
  return { args: meta };
}

/** Convert "Fetching mint info" → "fetching_mint_info" */
function eventKey(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 50);
}

export class CocoLogger implements Logger {
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
    // Merge bindings + meta. Bindings (mintUrl, etc.) go first so meta can override.
    const params: Record<string, unknown> | undefined =
      Object.keys(this.bindings).length > 0 || metaObj
        ? { ...this.bindings, ...metaObj }
        : undefined;
    cashuLog[level](event, params);
  }

  error(message: string, ...meta: unknown[]): void { this._emit('error', message, meta); }
  warn(message: string, ...meta: unknown[]): void { this._emit('warn', message, meta); }
  info(message: string, ...meta: unknown[]): void { this._emit('info', message, meta); }
  debug(message: string, ...meta: unknown[]): void { this._emit('debug', message, meta); }

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

    return new CocoLogger(nextPath, mergedBindings);
  }
}
