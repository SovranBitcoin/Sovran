import { type ZodType } from 'zod';
import { loggableIssues } from '@sovranbitcoin/schemas';
import { log } from '@/shared/lib/logger';

/**
 * Build a Zustand persist `merge` callback that validates the rehydrated blob
 * against a Zod schema describing the partialized shape. On failure, log the
 * issues (PII-safe via `loggableIssues`) and fall back to the in-memory
 * `current` state — never throw, never silently fold a malformed blob into
 * runtime state.
 *
 * The schema describes the *partialized* fields only; `current` carries the
 * full store including actions. The merge spreads validated data over current
 * so action methods are preserved.
 *
 * Pair with an explicit `version: N` and a `migrate(state, version)` on the
 * persist options so first-load migrations run before this validator sees the
 * shape. See `../.agents/skills/sovran-data-runtime/references/caching.md`.
 */
export function createMergeWithSchema<TPartial>(name: string, schema: ZodType<TPartial>) {
  return <TFull>(persisted: unknown, current: TFull): TFull => {
    if (!persisted || typeof persisted !== 'object') return current;
    const r = schema.safeParse(persisted);
    if (!r.success) {
      log.warn(`store.${name}.merge_rejected`, {
        issues: loggableIssues({
          type: 'schema/zod',
          where: name,
          issues: r.error.issues,
        }),
      });
      return current;
    }
    // The merge of persisted `current` with validated `r.data` produces the full
    // shape; TS can't prove completeness against the generic `TFull`, so assert
    // the merged value (not the object literal, per consistent-type-assertions).
    const merged = { ...current, ...r.data };
    return merged as TFull;
  };
}
