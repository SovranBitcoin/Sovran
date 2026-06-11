# Colada Documentation Conventions

These conventions keep Colada docs aligned with the shipped package. They are
not a roadmap and should not describe APIs that do not exist in source.

## Scope

The shipped docs are:

- `README.md`: public package overview and integration guide.
- `docs/CONVENTIONS.md`: rules for maintaining the docs.
- `docs/STATE_MACHINE.md`: authoritative `PaymentMachine` expectations reference
  (steps, destinations, per-flow sequencing, offline semantics, invariants). It
  is source-cited and hand-maintained; its own prime rule keeps it current --
  any flow change updates the doc and its named invariant in the same change.

Do not add flow, guide, pipeline, or method pages unless the content is generated
from source or kept current by tests. `docs/STATE_MACHINE.md` is the one
hand-maintained exception, allowed because every claim cites source and its
invariants are the durable guard against silent flow regressions. Delete stale
docs instead of leaving examples that compile only against old APIs.

## Accuracy Rules

- Describe shipped APIs only.
- Use flat `ColadaProvider` props. Never document grouped `engine`,
  `callbacks`, `runtime`, or `platform` props.
- Use adapter names from `ColadaProviderProps`, such as `clipboardAdapter`,
  `shareAdapter`, `imagePickerAdapter`, and `chainAdapter`.
- Show `useScreenActions(screenType, entryParam)` for terminal screens.
- Show the third `useScreenActions` argument only for `amountEntry`.
- Treat `sendToken.copy` emoji output as a copy variant. Never document a
  sibling emoji-copy action.
- Show `back` as part of every screen-action surface.
- Show `cancel` only where the action contract includes it.
- State that missing mint method-unit metadata is unsupported.
- State that apps own presentation, routing, storage, native modules, and
  product-specific enrichment.

## Naming

Disambiguate owners in prose:

- `machine.scan()` means a screen called the `PaymentMachine`.
- `handler.enterAmount()` means Colada called an app-provided step handler.
- `operations.executeSend()` means Colada called wallet I/O.
- `notifications.onReceiveConfirmed()` means Colada fired an optional
  side-effect callback.
- `actions.sendToken.copy()` means the wallet registered a handler.
- `boundActions.copy.execute()` means a screen invoked the bound action from
  `useScreenActions`.

Use exact public names from source. Link or mention the source file when a
contract matters:

- `src/react/ColadaProvider.tsx`
- `src/machine/types.ts`
- `src/screen-actions/types.ts`
- `src/adapters/types.ts`
- `src/subscriptions/types.ts`
- `src/mint-capabilities.ts`

## Examples

Examples should be short and should compile against the exported types with only
app-owned placeholders such as `router`, `toast`, or `walletOperations`.

Provider examples use flat props:

```tsx
<ColadaProvider
  handlers={createHandlers}
  operations={walletOperations}
  notifications={walletNotifications}
  actions={walletActions}
  clipboardAdapter={clipboardAdapter}
  shareAdapter={shareAdapter}
  chainAdapter={chainAdapter}
  navigation={{ goBack: () => router.back() }}
>
  <App />
</ColadaProvider>
```

Flow-screen examples bind wallet context explicitly:

```tsx
const machine = usePaymentFlowMachine({ walletContext, unit: 'sat' });
machine.scan(input, { source: 'clipboard' });
```

Terminal-screen examples use bound actions:

```tsx
const { entry, error, actions } = useScreenActions('sendToken', sendHistoryEntry);

if (error) return <ErrorState message={error} />;
if (!entry) return <LoadingState />;

return (
  <Button
    disabled={!actions.copy.available || actions.copy.loading}
    onPress={() => actions.copy.execute({ variantId: 'text' })}
    title="Copy"
  />
);
```

Amount-screen examples may include an amount config:

```tsx
const { entry, actions, suggestions } = useScreenActions('amountEntry', entrySeed, {
  amountConfig,
});
```

## Ownership Language

Use "Colada owns" only for behavior that lives in this package:

- payment-flow sequencing
- payment-state copy defaults and key resolution
- screen-action availability and default handlers
- typed subscription events
- chain adapter contracts and default mempool.space helpers
- JSON-shaped adapter contracts
- standard BIP-39 Cashu mnemonic and seed helper functions
- generic Nostr GraphQL query recipes when the app provides an endpoint URL

Use "the app owns" for:

- route names and navigation components
- UI components and layout
- persistent stores and profile state
- platform adapter implementations
- Coco manager instances and wallet-specific operations
- app-specific seed derivation paths, seed cache policy, and secret storage
- product-specific entry decoration
- backend selection and Nostr GraphQL endpoint configuration

## Compatibility Language

Do not use public docs to justify keeping retired API paths, duplicate shapes,
or speculative fallbacks. Colada has one app consumer in this workspace, so the
docs should describe the current shape only.

Allowed carve-outs are outside these docs unless the source contract requires
them:

- seed derivation paths that are frozen forever
- one Zustand persist migration per existing store shape change
- released sovran.money client compatibility

## Style

- ASCII only unless quoting an existing API name that requires otherwise.
- No emoji.
- No marketing claims.
- No roadmap wording about planned API shapes.
- Prefer concrete lists and tables over long prose.
- Keep code blocks small enough to audit.
- Do not mention implementation details from `sovran-app` unless they explain a
  public Colada seam.

## Stale-Doc Sweep

Before committing docs changes, search `README.md` and `docs/` for removed
provider, callback, and action names. Any hit must be either deleted or
rewritten to match the shipped API.
