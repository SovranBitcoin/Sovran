---
name: zustand-state-management
description: |
  Build type-safe global state in React with Zustand. Supports TypeScript, persist middleware, devtools, slices pattern, and Next.js SSR with hydration handling.

  Use when setting up React state, migrating from Redux/Context, or troubleshooting hydration errors, TypeScript inference, or infinite render loops.
user-invocable: true
---

# Zustand State Management

**Last Updated**: 2026-01-09
**Latest Version**: zustand@5.0.9 (current)
**Dependencies**: React 18+, TypeScript 5+

---

## Quick Start

```bash
npm install zustand
```

**TypeScript Store** (CRITICAL: use `create<T>()()` double parentheses):
```typescript
import { create } from 'zustand'

interface BearStore {
  bears: number
  increase: (by: number) => void
}

const useBearStore = create<BearStore>()((set) => ({
  bears: 0,
  increase: (by) => set((state) => ({ bears: state.bears + by })),
}))
```

**Use in Components**:
```tsx
const bears = useBearStore((state) => state.bears)  // Only re-renders when bears changes
const increase = useBearStore((state) => state.increase)
```

---

## Core Patterns

**Basic Store** (JavaScript):
```javascript
const useStore = create((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}))
```

**TypeScript Store** (Recommended):
```typescript
interface CounterStore { count: number; increment: () => void }
const useStore = create<CounterStore>()((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}))
```

**Persistent Store** (survives page reloads):
```typescript
import { persist, createJSONStorage } from 'zustand/middleware'

const useStore = create<UserPreferences>()(
  persist(
    (set) => ({ theme: 'system', setTheme: (theme) => set({ theme }) }),
    { name: 'user-preferences', storage: createJSONStorage(() => localStorage) },
  ),
)
```

---

## Critical Rules

### Always Do

✅ Use `create<T>()()` (double parentheses) in TypeScript for middleware compatibility
✅ Define separate interfaces for state and actions
✅ Use selector functions to extract specific state slices
✅ Use `set` with updater functions for derived state: `set((state) => ({ count: state.count + 1 }))`
✅ Use unique names for persist middleware storage keys
✅ Handle Next.js hydration with `hasHydrated` flag pattern
✅ Use `useShallow` hook for selecting multiple values
✅ Keep actions pure (no side effects except state updates)

### Never Do

❌ Use `create<T>(...)` (single parentheses) in TypeScript - breaks middleware types
❌ Mutate state directly: `set((state) => { state.count++; return state })` - use immutable updates
❌ Create new objects in selectors: `useStore((state) => ({ a: state.a }))` - causes infinite renders
❌ Use same storage name for multiple stores - causes data collisions
❌ Access localStorage during SSR without hydration check
❌ Use Zustand for server state - use TanStack Query instead
❌ Export store instance directly - always export the hook

---

## Known Issues Prevention

This skill prevents **5** documented issues:

### Issue #1: Next.js Hydration Mismatch

**Error**: `"Text content does not match server-rendered HTML"` or `"Hydration failed"`

**Source**:
- [DEV Community: Persist middleware in Next.js](https://dev.to/abdulsamad/how-to-use-zustands-persist-middleware-in-nextjs-4lb5)
- GitHub Discussions #2839

**Why It Happens**:
Persist middleware reads from localStorage on client but not on server, causing state mismatch.

**Prevention**:
```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface StoreWithHydration {
  count: number
  _hasHydrated: boolean
  setHasHydrated: (hydrated: boolean) => void
  increase: () => void
}

const useStore = create<StoreWithHydration>()(
  persist(
    (set) => ({
      count: 0,
      _hasHydrated: false,
      setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),
      increase: () => set((state) => ({ count: state.count + 1 })),
    }),
    {
      name: 'my-store',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    },
  ),
)

// In component
function MyComponent() {
  const hasHydrated = useStore((state) => state._hasHydrated)

  if (!hasHydrated) {
    return <div>Loading...</div>
  }

  // Now safe to render with persisted state
  return <ActualContent />
}
```

### Issue #2: TypeScript Double Parentheses Missing

**Error**: Type inference fails, `StateCreator` types break with middleware

**Source**: [Official Zustand TypeScript Guide](https://zustand.docs.pmnd.rs/guides/typescript)

**Why It Happens**:
The currying syntax `create<T>()()` is required for middleware to work with TypeScript inference.

**Prevention**:
```typescript
// ❌ WRONG - Single parentheses
const useStore = create<MyStore>((set) => ({
  // ...
}))

// ✅ CORRECT - Double parentheses
const useStore = create<MyStore>()((set) => ({
  // ...
}))
```

**Rule**: Always use `create<T>()()` in TypeScript, even without middleware (future-proof).

### Issue #3: Persist Middleware Import Error

**Error**: `"Attempted import error: 'createJSONStorage' is not exported from 'zustand/middleware'"`

**Source**: GitHub Discussion #2839

**Why It Happens**:
Wrong import path or version mismatch between zustand and build tools.

**Prevention**:
```typescript
// ✅ CORRECT imports for v5
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// Verify versions
// zustand@5.0.9 includes createJSONStorage
// zustand@4.x uses different API

// Check your package.json
// "zustand": "^5.0.9"
```

### Issue #4: Infinite Render Loop

**Error**: Component re-renders infinitely, browser freezes

**Source**: GitHub Discussions #2642

**Why It Happens**:
Creating new object references in selectors causes Zustand to think state changed.

**Prevention**:
```typescript
import { useShallow } from 'zustand/shallow'

// ❌ WRONG - Creates new object every time
const { bears, fishes } = useStore((state) => ({
  bears: state.bears,
  fishes: state.fishes,
}))

// ✅ CORRECT Option 1 - Select primitives separately
const bears = useStore((state) => state.bears)
const fishes = useStore((state) => state.fishes)

// ✅ CORRECT Option 2 - Use useShallow hook for multiple values
const { bears, fishes } = useStore(
  useShallow((state) => ({ bears: state.bears, fishes: state.fishes }))
)
```

### Issue #5: Slices Pattern TypeScript Complexity

**Error**: `StateCreator` types fail to infer, complex middleware types break

**Source**: [Official Slices Pattern Guide](https://github.com/pmndrs/zustand/blob/main/docs/guides/slices-pattern.md)

**Why It Happens**:
Combining multiple slices requires explicit type annotations for middleware compatibility.

**Prevention**:
```typescript
import { create, StateCreator } from 'zustand'

// Define slice types
interface BearSlice {
  bears: number
  addBear: () => void
}

interface FishSlice {
  fishes: number
  addFish: () => void
}

// Create slices with proper types
const createBearSlice: StateCreator<
  BearSlice & FishSlice,  // Combined store type
  [],                      // Middleware mutators (empty if none)
  [],                      // Chained middleware (empty if none)
  BearSlice               // This slice's type
> = (set) => ({
  bears: 0,
  addBear: () => set((state) => ({ bears: state.bears + 1 })),
})

const createFishSlice: StateCreator<
  BearSlice & FishSlice,
  [],
  [],
  FishSlice
> = (set) => ({
  fishes: 0,
  addFish: () => set((state) => ({ fishes: state.fishes + 1 })),
})

// Combine slices
const useStore = create<BearSlice & FishSlice>()((...a) => ({
  ...createBearSlice(...a),
  ...createFishSlice(...a),
}))
```

---

## Middleware

**Persist** (localStorage):
```typescript
import { persist, createJSONStorage } from 'zustand/middleware'

const useStore = create<MyStore>()(
  persist(
    (set) => ({ data: [], addItem: (item) => set((state) => ({ data: [...state.data, item] })) }),
    {
      name: 'my-storage',
      partialize: (state) => ({ data: state.data }),  // Only persist 'data'
    },
  ),
)
```

**Devtools** (Redux DevTools):
```typescript
import { devtools } from 'zustand/middleware'

const useStore = create<CounterStore>()(
  devtools(
    (set) => ({ count: 0, increment: () => set((s) => ({ count: s.count + 1 }), undefined, 'increment') }),
    { name: 'CounterStore' },
  ),
)
```

**Combining Middlewares** (order matters):
```typescript
const useStore = create<MyStore>()(devtools(persist((set) => ({ /* ... */ }), { name: 'storage' }), { name: 'MyStore' }))
```

---

## Common Patterns

**Computed/Derived Values** (in selector, not stored):
```typescript
const count = useStore((state) => state.items.length)  // Computed on read
```

**Async Actions**:
```typescript
const useAsyncStore = create<AsyncStore>()((set) => ({
  data: null,
  isLoading: false,
  fetchData: async () => {
    set({ isLoading: true })
    const response = await fetch('/api/data')
    set({ data: await response.text(), isLoading: false })
  },
}))
```

**Resetting Store**:
```typescript
const initialState = { count: 0, name: '' }
const useStore = create<ResettableStore>()((set) => ({
  ...initialState,
  reset: () => set(initialState),
}))
```

**Selector with Params**:
```typescript
const todo = useStore((state) => state.todos.find((t) => t.id === id))
```

---

## Bundled Resources

**Templates**: `basic-store.ts`, `typescript-store.ts`, `persist-store.ts`, `slices-pattern.ts`, `devtools-store.ts`, `nextjs-store.ts`, `computed-store.ts`, `async-actions-store.ts`

**References**: `middleware-guide.md` (persist/devtools/immer/custom), `typescript-patterns.md` (type inference issues), `nextjs-hydration.md` (SSR/hydration), `migration-guide.md` (from Redux/Context/v4)

**Scripts**: `check-versions.sh` (version compatibility)

---

## Advanced Topics

**Vanilla Store** (Without React):
```typescript
import { createStore } from 'zustand/vanilla'

const store = createStore<CounterStore>()((set) => ({ count: 0, increment: () => set((s) => ({ count: s.count + 1 })) }))
const unsubscribe = store.subscribe((state) => console.log(state.count))
store.getState().increment()
```

**Custom Middleware**:
```typescript
const logger: Logger = (f, name) => (set, get, store) => {
  const loggedSet: typeof set = (...a) => { set(...a); console.log(`[${name}]:`, get()) }
  return f(loggedSet, get, store)
}
```

**Immer Middleware** (Mutable Updates):
```typescript
import { immer } from 'zustand/middleware/immer'

const useStore = create<TodoStore>()(immer((set) => ({
  todos: [],
  addTodo: (text) => set((state) => { state.todos.push({ id: Date.now().toString(), text }) }),
})))
```

---

## Official Documentation

- **Zustand**: https://zustand.docs.pmnd.rs/
- **GitHub**: https://github.com/pmndrs/zustand
- **TypeScript Guide**: https://zustand.docs.pmnd.rs/guides/typescript
- **Context7 Library ID**: `/pmndrs/zustand`
