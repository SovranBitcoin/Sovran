---
paths: "shared/stores/**/*.ts"
description: Review Zustand store changes for backwards compatibility with persisted state on existing user devices.
---

# Zustand Persistence — Backwards Compatibility Review

When modifying any file under `shared/stores/` that uses `persist`, evaluate the change against every checklist item below. State "N/A" or "No issue" for items that don't apply — never skip silently.

## Project Context

- **Storage engine**: AsyncStorage via `createJSONStorage(() => AsyncStorage)`.
- **Profile-scoped stores** use `createProfileScopedStorage()` (keys formatted `{name}:profile:{pubkey}`). Registry lives in `PROFILE_SCOPED_STORE_KEYS` in `shared/lib/cashu/profileScopedStorage.ts`.
- **No `version` / `migrate`** on individual stores — schema evolution relies on Zustand's default shallow merge of initial state with persisted data, plus global migrations in `shared/lib/migrations/globalMigrations.ts`.
- **`partialize`** is used on every persisted store to select which fields survive across sessions.
- **Global migrations** (`shared/lib/migrations/globalMigrations.ts`) run once at startup before stores hydrate, gated by `signalMigrationsComplete()`.
- **Profile switches** currently reload the entire app; `_skipPersistWrite` prevents empty reset state from being written during the switch window.

---

## Checklist

### 1 — Field Existence After Rehydration

Because stores rely on shallow merge (no `version`/`migrate`), a **new top-level field** in initial state will get its default applied correctly — Zustand merges initial state under persisted keys. But a **new nested field inside an existing persisted object** will NOT be merged because shallow merge only operates at the first level.

- Does new code read a field that didn't exist before?
- Is that field nested inside an object that is already persisted (e.g., a new key inside `middlemanRouting`)? If so, the persisted outer object wins and the new nested default is lost.
- Does new code use `!`, direct property chains, or `.map()` on a value that could be `undefined` after rehydration?

### 2 — Field Removal or Rename

- Has a persisted field been renamed or removed?
- Is the old key still listed in `partialize`? If removed from `partialize`, old persisted data under that key becomes orphaned (harmless but wastes storage).
- Do any components, selectors, or effects still reference the old key?

### 3 — Type Changes

- Has a field's type changed (e.g., `string` to `object`, `boolean` to union)?
- Will deserialized old data of the previous type flow into code that assumes the new type?
- JSON serialization means `Date` objects come back as strings, `Map`/`Set` come back as plain objects or arrays — verify assumptions.

### 4 — Structural Reshaping

- Has data been moved deeper or flattened?
- Shallow merge will use the old shape as-is for any top-level key that exists in persisted data, so inner restructuring is invisible to the merge.
- Will old persisted data with the previous structure cause `.property` access on `undefined`?

### 5 — Enum / Union / Constant Changes

- Have string literals, union members, or enum values changed?
- Are there `switch` / conditional / lookup paths that no longer handle old persisted values?
- Is there a fallback default case?

### 6 — Collection Shape Changes

- Has a collection changed between `Array<T>` and `Record<string, T>`?
- Have required fields been added to items inside a persisted collection?
- Will old items without the new fields crash when iterated or rendered?

### 7 — Persist Configuration

- Has the `name` (storage key) changed? This orphans all previously stored data.
- Has `partialize` changed? If a field was added to `partialize`, it starts persisting now but old data won't have it — is the initial-state default sufficient? If a field was removed from `partialize`, does other code still expect it to survive sessions?
- If a `version` or `migrate` was added: does the migration handle the "no version" case (existing users who have never had a version in their persisted data)?
- For profile-scoped stores: was the new key added to `PROFILE_SCOPED_STORE_KEYS`? Missing it means the store won't be scoped to profiles and will silently share data across accounts.

### 8 — Default Values and Shallow Merge

This is the most common source of bugs in this project because we don't use `version`/`migrate`.

- New **top-level** fields with defaults: safe — shallow merge applies the default.
- New **nested** fields inside an already-persisted object: **unsafe** — shallow merge keeps the entire persisted outer object, dropping new nested defaults.
  - Example: adding `middlemanRouting.newFlag: true` to `DEFAULT_MIDDLEMAN_ROUTING` will NOT take effect for existing users because `middlemanRouting` already exists in their persisted data and shallow merge uses it wholesale.
- Fix: either add a runtime fallback (`state.middlemanRouting.newFlag ?? true`), or add a global migration, or add `merge: deepMerge` to the persist config.

### 9 — Cross-Store Dependencies

- Does this store read from another store (e.g., profile-scoped stores depend on `profileStore` for pubkey)?
- Has the depended-upon store's shape changed?
- Is there a hydration ordering issue? Profile-scoped stores wait on `_migrationGate` and `ensureProfileStoreHydrated()` — verify new cross-store reads respect this gate.
- If a new profile-scoped store was added: is it registered in `PROFILE_SCOPED_STORE_KEYS` and included in `rehydrateProfileStores()`?

### 10 — Persisted vs Computed State

- Was a previously persisted value changed to be computed at runtime? It will be `undefined` on first render before computation.
- Was a previously computed value added to `partialize`? Old users won't have it in storage — is the initial-state default safe?

---

## Finding Format

For each issue, produce:

```
### Finding [N]: [Short title]

**Category:** [Checklist # and name]
**Severity:** CRITICAL | HIGH | MEDIUM | LOW
**File:** [path:line range]
**Affected users:** [Existing upgraders / New installs / Both]

**Before (persisted shape):**
[Old persisted data or old code]

**After (new assumption):**
[New code and what it assumes]

**Breakage scenario:**
1. User has version X with persisted state: `{ ... }`
2. User upgrades.
3. App rehydrates old state via shallow merge.
4. Code at [file:line] does [operation], which [crashes / wrong value / data loss] because [reason].

**Fix:**
[Runtime fallback with `??`, global migration in globalMigrations.ts, or merge strategy change]
```

If no issues are found after evaluating every item, state: **"No backwards compatibility issues found."**
