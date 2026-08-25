/**
 * @fileoverview Per-entry tolerant collection schemas for persisted stores.
 *
 * The standard persist `merge` discards the ENTIRE blob when any one field
 * fails parse (see `createMergeWithSchema`), so a collection whose entry
 * schema hard-rejects — deliberately, for values that must never be guessed
 * (attribution, custody, funds-flow direction, deletion intent) — needs the
 * rejection contained to the entry. These wrappers safeParse each entry and
 * drop only the bad ones: the blob survives, the un-guessable row does not.
 *
 * Use `.catch(...)` on the field instead when a safe neutral member exists;
 * use these when it doesn't. Prior art: swapTransactionsStore's quote index.
 */
import { z } from 'zod';

/** `z.record` that drops entries failing `entrySchema` instead of the blob. */
export function tolerantRecord<V extends z.ZodType>(keySchema: z.ZodString, entrySchema: V) {
  return z
    .record(keySchema, z.unknown())
    .default({})
    .transform(
      (entries) =>
        Object.fromEntries(
          Object.entries(entries).flatMap(([key, value]) => {
            const parsed = entrySchema.safeParse(value);
            return parsed.success ? [[key, parsed.data] as const] : [];
          })
        ) as Record<string, z.output<V>>
    );
}

/** `z.array` that drops items failing `entrySchema` instead of the blob. */
export function tolerantArray<V extends z.ZodType>(entrySchema: V, max: number) {
  return z
    .array(z.unknown())
    .max(max)
    .transform((items) =>
      items.flatMap((value) => {
        const parsed = entrySchema.safeParse(value);
        return parsed.success ? [parsed.data as z.output<V>] : [];
      })
    );
}
