/**
 * @fileoverview Per-entry tolerant collection schemas for persisted stores.
 *
 * The standard persist `merge` discards the ENTIRE blob when any one field
 * fails parse (see `createMergeWithSchema`), so a collection whose entry
 * schema hard-rejects — deliberately, for values that must never be guessed
 * (attribution, custody, funds-flow direction, deletion intent) — needs the
 * rejection contained to the entry. These wrappers parse each entry and drop
 * only the bad ones: the blob survives, the un-guessable row does not.
 *
 * Use `.catch(...)` on the field instead when a safe neutral member exists;
 * use these when it doesn't. Prior art: swapTransactionsStore's quote index.
 *
 * Containment is expressed as `entrySchema.optional().catch(undefined)` INSIDE
 * the collection rather than as a `z.unknown()` collection with a `safeParse`
 * in the transform. Both drop the same rows for every entry schema in use
 * here — the one difference is an entry that PARSES SUCCESSFULLY to
 * `undefined`, which the old form kept as an `undefined` slot and this one
 * drops; no caller does that, and a collection of `undefined` holes was not
 * the intent either way. What this form buys is the entry schema staying in
 * the tree, which two guards depend on: `persistSchemaDrift` snapshots
 * `z.toJSONSchema` of the whole schema and would otherwise stop recording the
 * row's shape entirely — a non-additive change inside a row would sail past
 * it — and `persistedEnumTolerance` walks the same tree for enums that could
 * reject a blob.
 */
import { z } from 'zod';

/** Entry schema that yields `undefined` instead of failing the collection. */
function containedEntry<V extends z.ZodType>(entrySchema: V) {
  return entrySchema.optional().catch(undefined);
}

/**
 * The key contract, published where `persistSchemaDrift` can snapshot it.
 *
 * The key cannot go in the record's own key position (see `tolerantRecord`),
 * so it would otherwise live only inside the transform closure — invisible,
 * and a `max(128)` quietly tightened to `max(64)` would start dropping keys
 * the store used to keep with no guard moving.
 */
function keyContract(keySchema: z.ZodType): Record<string, unknown> {
  // Both lenses: a key schema that is a pipe (`z.pipe(z.string().max(128),
  // …)`) carries its constraint on the input side, and the output side alone
  // would not move when it is tightened.
  //
  // Never throws. `toJSONSchema` rejects some legal schemas outright — a
  // context-dependent `.catch(ctx => …)` among them — and this runs at module
  // load, so a throw here is a store that cannot be imported and an app that
  // cannot boot. A shape it cannot express is recorded as unrepresentable
  // rather than crashing; that key's contract is then outside what the drift
  // snapshot can see, which is a reporting limit, not a broken build.
  const lens = (io: 'input' | 'output'): unknown => {
    try {
      const { $schema: _ignored, ...shape } = z.toJSONSchema(keySchema, {
        unrepresentable: 'any',
        io,
      }) as Record<string, unknown>;
      return shape;
    } catch {
      return { unrepresentable: true };
    }
  };
  return { input: lens('input'), output: lens('output') };
}

/**
 * `z.record` that drops entries failing `keySchema` or `entrySchema` instead
 * of the blob.
 *
 * The key is checked per entry rather than by handing `keySchema` to
 * `z.record`. `z.record(keySchema, …)` validates keys BEFORE the transform
 * runs, so one malformed key rejected the whole record — and, through
 * `createMergeWithSchema`, the whole store. That is exactly the failure this
 * module exists to prevent, and it was also why the stores with the widest
 * blast radius (a signer trust store keyed by client pubkey, a follow set
 * keyed by pubkey) could not adopt it: their key schemas are branded
 * `z.custom` predicates, which `z.record` will not take.
 */
export function tolerantRecord<K extends string, V extends z.ZodType>(
  keySchema: z.ZodType<K>,
  entrySchema: V
) {
  return z
    .record(z.string(), containedEntry(entrySchema))
    .meta({ tolerantKey: keyContract(keySchema) })
    .default({})
    .transform(
      (entries) =>
        Object.fromEntries(
          Object.entries(entries).flatMap(([key, value]) => {
            if (value === undefined) return [];
            const parsedKey = keySchema.safeParse(key);
            return parsedKey.success ? [[parsedKey.data, value] as const] : [];
          })
        ) as Record<K, z.output<V>>
    );
}

/** `z.array` that drops items failing `entrySchema` instead of the blob. */
export function tolerantArray<V extends z.ZodType>(entrySchema: V, max: number) {
  return z
    .array(containedEntry(entrySchema))
    .max(max)
    .transform((items) => items.filter((item) => item !== undefined) as z.output<V>[]);
}
