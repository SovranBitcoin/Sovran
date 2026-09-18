---
name: sovran-zustand
description: Implement or review Sovran Zustand stores, selectors, hydration, subscriptions, cache freshness, and profile switching. Use for state ownership or render-subscription changes, not as a reason to create a new global store.
---

Read [SYSTEM.md decision 12](../../SYSTEM.md#12-react-and-zustand-state), plus
[persistence](../../SYSTEM.md#13-zod-persistence-and-migrations) or
[caches](../../SYSTEM.md#14-cache-ownership-and-freshness) when relevant.

Trace the owner and lifetime before changing the state: local interaction,
global preference, profile-owned data, runtime state, query result, or wallet
authority. Reuse that owner and its actions rather than mirror it into a screen
store. Group values that must change atomically without silently changing their
persisted shape.

In React, subscribe to the smallest useful selection. For multiple fields, use
`useShallow` only when shallow equality matches the contract. Check selectors for
fresh array/object/function fallbacks, not just obvious whole-store reads.
Preserve references for unchanged entities. Use `getState()` in imperative
handlers, not as a render subscription.

For an async action, trace cancellation, duplicate work, response ordering,
captured identity, and teardown. A loading boolean and `try/catch` alone do not
prevent an old response writing into a new profile. Subscribe with a clear owner
and disposer. Read the clock once for an atomic freshness update.

Use the app's `persistConfig` and storage scope. Browser `localStorage` recipes
are not native persistence. Keep secret data, managers, functions, promises, and
transient flags out of durable projections. Do not add Immer, Jotai, or another
cache library to follow a tutorial.

Verify the observable change: unrelated field updates do not wake the subscriber,
hydration preserves supported old data, disposal removes listeners, and stale
async completion cannot cross the tested scope. Match tests to the change rather
than adding all of these for every selector edit.

References: [Zustand v5 selector stability](https://zustand.docs.pmnd.rs/reference/migrations/migrating-to-v5),
[persist middleware](https://zustand.docs.pmnd.rs/reference/integrations/persisting-store-data).
This is a project-authored workflow, not the third-party `zustand-5` tutorial.
