import { type ZodType } from 'zod';
import { loggableIssues } from '@sovranbitcoin/schemas';
import { log } from '@/shared/lib/logger';

/**
 * Build a Zustand persist `merge` callback that validates the rehydrated blob
 * against a Zod schema describing the partialized shape. On failure, log the
 * issues (PII-safe via `loggableIssues`) and fall back to the in-memory
 * `current` state — never throw, never silently fold a malformed blob into
 * runtime state. A store that says its fields are independent keeps the
 * fields that do parse (`independentFields`).
 *
 * The schema describes the *partialized* fields only; `current` carries the
 * full store including actions. The merge spreads validated data over current
 * so action methods are preserved.
 *
 * Pair with an explicit `version: N` and a `migrate(state, version)` on the
 * persist options so first-load migrations run before this validator sees the
 * shape. See `docs/review/conventions-state.md`.
 */
export function createMergeWithSchema<TPartial>(
  name: string,
  schema: ZodType<TPartial>,
  options: MergeWithSchemaOptions = {}
) {
  return <TFull>(persisted: unknown, current: TFull): TFull => {
    if (!persisted || typeof persisted !== 'object') return current;
    const r = schema.safeParse(persisted);
    if (r.success) return { ...current, ...r.data } as TFull;

    log.warn(`store.${name}.merge_rejected`, {
      issues: loggableIssues({
        type: 'schema/zod',
        where: name,
        issues: r.error.issues,
      }),
    });
    options.onRejected?.();
    const fields = options.independentFields ? fieldSchemas(schema) : null;
    if (!fields) return current;

    // One bad field must not cost the others. Take out the fields that do
    // not parse on their own and ask the schema again: it fills their
    // defaults exactly as a normal load would, and it still has the last word,
    // so a blob that breaks a rule spanning fields, or lacks a field with no
    // default, stays turned down.
    const dropped = Object.keys(fields).filter(
      (key) =>
        key in persisted &&
        !fields[key].safeParse((persisted as Record<string, unknown>)[key]).success
    );
    const withoutBadFields = Object.fromEntries(
      Object.entries(persisted).filter(([key]) => !dropped.includes(key))
    );
    const again = schema.safeParse(withoutBadFields);
    if (dropped.length === 0 || !again.success) return current;
    log.warn(`store.${name}.merge_kept_fields`, { dropped });
    return { ...current, ...again.data } as TFull;
  };
}

interface MergeWithSchemaOptions {
  /**
   * The saved fields mean the same whether or not their neighbours loaded, so
   * a blob the schema turns down is read again without the fields that do not
   * parse, each of which needs a default in the schema. Leave it off for a store whose fields refer to each
   * other (an index into a list, an id that must exist in a map): half of
   * such a store is worse than none of it.
   */
  independentFields?: boolean;
  /** Called when the blob as a whole was turned down, before any field is kept. */
  onRejected?: () => void;
}

/** The per-field schemas of an object schema; null for any other kind. */
function fieldSchemas(schema: ZodType<unknown>): Record<string, ZodType<unknown>> | null {
  const shape = (schema as { shape?: unknown }).shape;
  return shape && typeof shape === 'object' ? (shape as Record<string, ZodType<unknown>>) : null;
}
