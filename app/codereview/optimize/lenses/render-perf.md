# Lens: render performance (React Compiler, re-renders, zustand)

Scope: `app/features`, `app/shared`, `app/app`. React 19.2 + React Compiler is
enabled — that changes what matters: the compiler memoizes *compiled*
components, so the biggest wins are components the compiler **skips**.

## React Compiler coverage

- The compiler silently skips any component with a Rules-of-React violation.
  A skipped component gets zero automatic memoization. Detect:
  `eslint-disable` on `react-hooks/*` rules — treat each as "this component is
  uncompiled", then judge its render cost.
- `'use no memo'` directives opt components out entirely — each needs a
  justification comment; flag bare ones on hot components.
- Compiler comparison is shallow: selectors/props that rebuild nested
  objects/arrays per render still defeat it. Detect: `.map(`/`.filter(`/spread
  building props inline in hot components.
- Mutation during render (`.push()`, `.sort()` on props/state) both breaks the
  rules and skips compilation. `sort` without `[...arr]` copy is the classic.
- `bun run check:react-compiler` reports coverage — but with a custom
  babel config it can false-green with "0 of 0 components"; sanity-check the
  scanned-file count before trusting it.

## Effect cascades

- `useEffect` that `setState`s something consumed by another effect's deps =
  render waterfall. Detect: two effects in one file chained through state.
- Derived state in effects (`useEffect(() => setX(f(y)), [y])`) should be
  computed in render. Detect statically.
- Fetch-in-`useEffect(..., [])` on screens re-entered via back-nav refires on
  remount. Cross-check with the navigation lens before flagging.

## Zustand 5

- Bare `useXStore()` with no selector re-renders on every store write. Detect:
  `useStore()` / `useXStore()` with zero args in components.
- Object/array-returning selectors without `useShallow` either re-render
  always or hit the v5 infinite-loop error. Detect: selector returning
  `({ a, b })`, `.map()`, `.filter()` not wrapped in `useShallow`.
- Selectors doing derivation (filter/sort) run on every store write for every
  subscriber — hoist heavy derivation into the store or memoize.
- `useStore(s => s)` convenience objects = whole-store subscription.

## Inline props (matters for uncompiled + native components)

- `style={{...}}`, `contentContainerStyle={{...}}`, inline `renderItem`,
  `ListHeaderComponent={<X/>}` — worst inside list items and screen roots.

## Evidence

```bash
npx tsx codereview/log-doctor/index.ts renders --latest   # re-render counts + why-did-update
rg -n "eslint-disable.*react-hooks" app features shared
rg -n "'use no memo'" app features shared
rg -n "useShallow" features shared        # then find object selectors missing it
bun run check:react-compiler
```

A finding here is real only with either a runtime render count, or a hot-path
argument (list item, screen root, per-frame subscriber). "This could
re-render" without a consumer that cares is not a finding.

## Do not flag

- Manual `useMemo`/`useCallback` that the compiler makes redundant.
- Re-renders of leaf components with trivial render cost.
- Anything eslint-plugin-react-perf already reports un-suppressed.
