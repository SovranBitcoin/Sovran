# coco-payment-ux

> **Target API:** This document describes how we **want** the package to be used. Concrete export names, prop shapes, and provider wiring may differ until the implementation matches—treat this as the north star, not a changelog.

## What this package is

**Flow machine** — Parses payment-related input, advances through steps (amount, mint selection, scan pipeline, send/receive orchestration), and delegates **navigation and side effects** through **step handlers**. Optional **operations** let the wallet run async work (e.g. execute send, create mint quote) inside the machine’s transitions so screens stay thin.

**Screen actions** — A separate layer for **post-terminal** screens: typed actions bound to a **history entry** (copy, pay, redeem, cancel, etc.) with **availability** and **loading** per action. This is intentionally separate from the flow machine so detail screens do not reimplement business logic.

## Desired root provider: `CocoPaymentUXProvider`

The package should ship a **single, generic** root component named **`CocoPaymentUXProvider`** (this is the name used throughout this doc). Apps mount it **once** with **flat props**—no nested `config` object, no bespoke wrapper that wires dozens of refs.

**Design goals (agreed):**

1. **Flat API (prop 1.A)** — `handlers`, `operations`, `notifications`, `actions`, platform sources, and persistence callbacks are **top-level props**, not `config={{ ... }}`.
2. **Simple app code** — The app should not juggle `pubkeyRef`, `managerRef`, `walletContextRef`, and a manual `createHandlers(machine, refs)` factory. The provider (and implementation inside coco-payment-ux) owns **internal wiring**; the app passes **plain functions or objects** and optional **persistence** callbacks. Whatever minimizes ref soup at the call site wins.
3. **Mint / NPC persistence** — Persistence lives in the **app** (stores, SecureStore, API). The provider exposes **named callbacks** the machine invokes when the user’s choice should be saved, e.g. **`savePreferredMint(mintUrl)`** and **`saveNpcMint(mintUrl)`** (exact names TBD). coco-payment-ux does not store mints; it only notifies the app to persist.
4. **One tree** — This same provider registers everything **`useScreenActions`** needs (manager, payment machine, sources) via context. Most screens use **two arguments**; the **amount entry** screen passes a third options object with **`amountConfig`** (see [Amount entry](#amount-entry-screen-amountentry)).
5. **Defaults + overrides** — The package ships **sensible defaults** (e.g. clipboard + gallery scan behavior, optional UR decoder hook-up) where it can; apps **override** props when they need custom behavior.

### Flat props (target)

| Prop                          | Role                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`handlers`**                | Step handlers the machine invokes—navigation entry points for the payment flow (e.g. open amount screen, navigate to token detail, dismiss). Shape TBD: ideally a plain map; implementation may use context to supply `machine` without a factory at the app.                                                                                          |
| **`operations`**              | Async wallet operations the machine runs for certain steps when provided (e.g. confirm send, create mint quote). When set, some paths are handled internally and handlers only see **result** steps.                                                                                                                                                   |
| **`notifications`**           | Informational feedback from the machine (errors, validation). Non-blocking; if a key has no handler, it is ignored.                                                                                                                                                                                                                                    |
| **`actions`**                 | Handler implementations for **predefined** (and optionally **custom**) per-screen actions—see [Predefined actions](#predefined-actions-and-optional-custom-ones). `useScreenActions` resolves them by `screenType`.                                                                                                                                    |
| **`screenActionsBridge`**     | Optional wallet-only wiring for **`useScreenActions`**: extra action context (`getExtraContext`), history / melt subscriptions (`onEntryUpdate`), entry merge rules, **`decorateEntry`**, **`getLocale`**, scan provenance (**`getSourceLabel`**), and **`subscribeGlobalScreenActions`** for reactive labels. See `src/react/screenActionsBridge.ts`. |
| **`savePreferredMint`**       | Called when the flow should persist the user’s **selected send/receive mint** (app writes to its store).                                                                                                                                                                                                                                               |
| **`saveNpcMint`**             | Called when the flow should persist the **NPC / Lightning-address mint** only (app writes + optional server sync).                                                                                                                                                                                                                                     |
| **`onNpcMintSync`**           | Optional: run when provider mounts if the app needs to sync NPC mint from server (wallet-specific).                                                                                                                                                                                                                                                    |
| **`clipboardSource`**         | Returns clipboard text for paste / scan-from-clipboard flows.                                                                                                                                                                                                                                                                                          |
| **`shareSource`**             | Platform share primitive (e.g. React Native `Share`). Merged into action context for **`share`** actions.                                                                                                                                                                                                                                              |
| **`cameraPermissionsSource`** | Requests or checks camera permission for QR flows.                                                                                                                                                                                                                                                                                                     |
| **`imagePickerSource`**       | Opens gallery / image picker for QR-from-image flows.                                                                                                                                                                                                                                                                                                  |

Optional overrides (names illustrative): **`createURDecoder`**, **`scanSources`** — omitted when defaults suffice.

Screens should not import Expo clipboard, camera, or image-picker for these flows unless overriding—the provider injects them at the boundary.

**Implementation status:** coco-payment-ux ships **`CocoPaymentUXProvider`** with **flat props** (`handlers`, `operations`, `notifications`, `actions`, optional **`screenActionsBridge`**, `savePreferredMint`, `saveNpcMint`, `onNpcMintSync`, `walletContextRef`, `createURDecoder`, `scanSources`, `detectors`, `getOffline`). The old nested `config={{ … }}` API is removed.

### Naming & legacy exports

- The **only** root provider name in the public API is **`CocoPaymentUXProvider`**.

### Wallet context and `usePaymentFlowMachine` (recommended)

**Recommendation:** Keep building **`WalletContext`** in the app (selected mint, trusted mint URLs, proof amounts, etc.) and pass it into **`usePaymentFlowMachine({ walletContext, unit })`** on each flow screen.

**Why not push all of that into the root provider?** Balance and proofs are **profile- and route-scoped**; the app already has stores and overrides (e.g. mint select for a specific flow). Duplicating that graph inside coco-payment-ux would recreate your state layer. The provider should own **machine + injected services + screen-action context**, not clone **Zustand / profile** state.

**Summary:** **`CocoPaymentUXProvider`** once at the root; **`usePaymentFlowMachine`** still receives **`walletContext`** from the screen’s hooks—thin, explicit, testable.

### Handlers, operations, and notifications (how they fit together)

**Principle:** The **machine** owns sequencing, guards, and which step comes next. **Handlers** should be thin—mostly “given this step payload, navigate or show UI”—not duplicate wallet rules. **Operations** are the async **wallet I/O** the machine calls when it needs a real effect (send, mint quote, build mint list). **Notifications** are **optional** UX hooks keyed by situation (often error codes); if the wallet does not register a handler for that key, the machine **continues silently** (no throw, no blocking).

Example story (target behavior): the user starts a send flow. The machine checks prerequisites (e.g. balance) **before** or **instead of** blindly navigating. If there is no spendable balance, the machine dispatches e.g. `NO_BALANCE` to **notifications**. If `notifications.NO_BALANCE` is set, the wallet shows a toast; if it is omitted, nothing is shown and the flow stops or redirects according to machine rules—without putting that branching inside a step handler.

#### Example: a good **step handler** (navigation only)

Handlers receive **fully prepared** step data from the machine. They should not re-derive business rules the machine already resolved.

```ts
// enterAmount — open the amount screen with constraints the machine computed
enterAmount: ({ unit, preselectedMintUrl, constraints }) => {
  router.push({
    pathname: '/amount',
    params: {
      unit,
      selectedMintUrl: preselectedMintUrl ?? '',
      destination: constraints.destination,
    },
  });
};

// sendComplete — machine finished a send; navigate to the token detail screen
sendComplete: ({ historyEntry }) => {
  router.push({ pathname: '/sendToken', params: { sendHistoryEntry: historyEntry } });
};
```

No balance checks here—the machine decided that `enterAmount` or `sendComplete` is the right step.

#### Example: a good **operation** (async wallet work)

Operations return **facts** the machine needs for the next transition (e.g. serialized history entry for navigation). They should not navigate; the machine calls **handlers** for that after success or error routing.

```ts
const operations = {
  executeSend: async (mintUrl, amount) => {
    const result = await manager.send.prepareAndExecute(mintUrl, amount);
    return { historyEntry: JSON.stringify(result.historyEntry) };
  },

  executeMintQuote: async (mintUrl, amount, unit) => {
    const quote = await manager.mint.createQuote(mintUrl, amount, unit);
    return { historyEntry: JSON.stringify(quote.historyEntry) };
  },

  buildMintListItems: async (selectMintStepData) => {
    return buildRowsFromWalletState(selectMintStepData);
  },
};
```

#### Example: a good **notification** (optional, fire-and-forget)

Notifications map **machine-identified situations** to **presentation**. Unregistered keys are no-ops.

```ts
const notifications = {
  // ErrorCode keys — machine lands on error step or emits before navigation
  NO_BALANCE: ({ message }) => {
    toast.info(message ?? 'No balance available');
  },
  INSUFFICIENT_BALANCE: ({ message }) => {
    toast.warning(message ?? 'Not enough funds');
  },

  // Scan pipeline — optional UX when clipboard / gallery yields nothing
  onScanEmpty: (source) => {
    toast.info(`Nothing to paste (${source})`);
  },
  onScanError: (source, err) => {
    console.warn(source, err);
  },
};
```

Together: **handlers** move the user between routes; **operations** talk to **coco-cashu** (or your wallet); **notifications** are the thin UI layer for edge cases the machine detects. The **machine** is what links them so screens and handlers stay dumb.

## Terminal screens: `useScreenActions`

For screens that show a **single history entry** and a small set of buttons (send token, receive token, melt quote, mint quote, receive hub, etc.), the **canonical** API is **two arguments** — no per-screen “context” objects. The **amount** flow screen is the exception: **`amountEntry`** plus **`{ amountConfig }`** (see below).

```tsx
const { entry, error, actions, source } = useScreenActions('sendToken', sendHistoryEntry);
```

Same shape **everywhere** (`'receiveToken'`, `'meltQuote'`, `'receive'`, …). The hook should export almost everything the screen needs from that call site; optional wallet-specific fields (e.g. `source` for scan provenance, decorated timestamps) are extra return keys, not extra parameters.

| Argument         | Meaning                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------- |
| **`screenType`** | Which predefined action set and availability rules apply (`src/screen-actions/types.ts`). |
| **`entryParam`** | JSON string from the router **or** a parsed history entry object.                         |

**Returns (target):**

| Field         | Role                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **`entry`**   | Current entry (optionally decorated by the wallet — formatted strings, timestamps, etc.).                                                  |
| **`error`**   | Parse/missing-entry error for early exit UI.                                                                                               |
| **`actions`** | Bound map: each name has `available`, `loading`, `execute(params?)`.                                                                       |
| **`source`**  | Optional scan provenance label when the wallet’s **`screenActionsBridge.getSourceLabel`** is set; always **`null`** for **`amountEntry`**. |

Wallet apps may add more return fields (e.g. **`source`**, labels). The **call site** is **two arguments** for history-driven screens; **`amountEntry`** adds a **third** `{ amountConfig }` (see [Amount entry](#amount-entry-screen-amountentry)).

**Where the rest comes from:** Handlers come from the provider **`actions`** prop. **`paymentMachine`** is always injected by the hook from context. Other extras (**`manager`**, Nostr **`sendDirectMessage`**, **`requestCameraPermission`**, history + melt **`onEntryUpdate`**, **`decorateEntry`**, **`source`**) come from the optional **`screenActionsBridge`** prop on **`CocoPaymentUXProvider`**, so apps do not wrap **`useScreenActions`** in a second hook.

Each action is still a **bound** object:

- `available` — Whether the action should be offered.
- `loading` — Whether an async execute is in flight.
- `execute(params?)` — Run the handler; use small params only when the **UI** varies behavior (e.g. `{ source: 'npc' \| 'p2pk' }` for copy). Platform **sources** belong on the provider and in **`getExtraContext`**, not in `useScreenActions(...)`.

**Note:** The hook return value **`actions`** (bound `execute` / `available` / `loading`) is **not** the same as the provider prop **`actions`** (the handler map you register once).

**Implementation note:** The app wrapper may pass a **third** argument only for **`screenType: 'amountEntry'`** (`amountConfig`). All other screen types stay at two arguments.

Screens stay declarative: gate on `error` / missing `entry`, then wire `ButtonHandler` (or similar) with `condition: actions.foo.available` and `loading: actions.foo.loading`.

### Predefined actions (and optional custom ones)

**Predefined** means: for each **`ScreenType`**, coco-payment-ux declares a **fixed set of action names** that cover the usual terminal/detail flows. Availability rules live in one place (`getAvailableActions`); the wallet only implements **handlers** for those names—no per-page reinvention of “can I pay yet?”.

| Screen type      | Predefined actions (target set)                                |
| ---------------- | -------------------------------------------------------------- |
| `sendToken`      | `copy`, `share`, `nfc`, `copyAsEmoji`, `checkStatus`, `cancel` |
| `receiveToken`   | `redeem`                                                       |
| `mintQuote`      | `copy`, `share`                                                |
| `meltQuote`      | `pay`, `cancel`                                                |
| `paymentRequest` | `confirm`, `cancel`                                            |
| `receive` (hub)  | `copy`, `paste`, `fixedAmount`, `scanQr`, `changeNpcMint`      |
| `amountEntry`    | `setInput`, `toggle`, `next`, `paste`, `scanQr`                |

Authoritative source: `src/screen-actions/types.ts` (`ScreenActionName`).

### Amount entry screen (`amountEntry`)

The flow **amount** route (send/receive) uses the same **screen-actions** pattern as terminal screens: **`useScreenActions('amountEntry', entrySeed, { amountConfig })`**.

- **`entrySeed`** — Stable fields merged into the live entry: `destination`, `unit`, `selectedMintUrl`, optional `paymentRequest` / `meltTarget`, and (for availability) `fiatCurrency` + `btcPrice` when fiat toggle applies. Re-create or memoize when mint or route params change so the manager’s base entry stays in sync.
- **`amountConfig`** — **`CreateAmountActionManagerConfig`**: getters (`getMintUrl`, `getProofAmounts`, `getBtcPrice`, …) so sat/fiat input, offline sendability, and keyboard state stay in **`createAmountActionManager`** while **`setInput`** / **`toggle`** run **synchronously** (no per-key loading). **`next`** / **`paste`** / **`scanQr`** are wallet handlers with **`loading`**.
- **`setInput` / `toggle`** — Invoked as `actions.setInput.execute({ input })` and `actions.toggle.execute()`; no separate `useAmountActions` hook.
- **Machine validation** — On **`AMOUNT_ENTERED`**, if **`amount > 0`** and **`mintUrl`** is empty/whitespace, the machine calls **`notifications.onMissingMintForAmount`** (optional) so the wallet can toast instead of guarding only in the route. **`offline`** on the event is merged from **`getOffline?.()`** on **`CreateMachineConfig`** when omitted, so routes do not need to pass **`offline`** into **`enterAmount`**.
- **Sovran** — Implement **`screenActionsBridge`** once in **`features/send/providers/CocoPaymentUX.tsx`** (same extras as before: manager, history/melt subscriptions, formatted entry, scan **`source`**). Pass **`amountConfig`** as the third argument only for **`amountEntry`**.

**Wallet wiring:** You register implementations once (e.g. `createSovranScreenActionHandlers()`), keyed by screen type and action name, and pass them as the provider **`actions`** prop. Each handler receives **`ScreenActionContext`** (`entry`, `manager`, plus merged **sources** and extras—`shareSource`, `paymentMachine`, etc.).

```ts
// Pseudocode — pass as <CocoPaymentUXProvider actions={walletActions} shareSource={...} />
const walletActions = {
  sendToken: {
    copy: async (ctx) => {
      /* Clipboard + toast */
    },
    share: async (ctx) => {
      // Use provider-injected share primitive — do not import Share in every screen
      await ctx.shareSource?.({ message: ctx.entry.tokenString, title: 'Ecash' });
    },
    cancel: async (ctx) => {
      /* Cancel operation */
    },
    // …
  },
  meltQuote: {
    pay: async (ctx) => {
      /* prepareMelt / executeMelt */
    },
    cancel: async (ctx) => {
      /* router.back or melt cancel */
    },
  },
  receive: {
    copy: async (ctx) => {
      /* npc vs p2pk via execute() params from UI */
    },
    paste: async (ctx) => {
      await ctx.paymentMachine?.scan?.();
    },
    // …
  },
};
```

**Custom / extended actions (target):** Standard pages use only the predefined matrix. For one-off product screens, the wallet should be able to register **additional** action names (e.g. `exportToken`, `openInExplorer`) without breaking the core types—e.g. by merging a **`ScreenActionHandlerMap` extension** at the app layer or by a future extension map merged into the provider **`actions`** prop. The rule: **defaults cover the necessary cases**; **extensions are convenience**, implemented beside the same `useScreenActions` pattern (`execute` / `available` / `loading`) so pages stay consistent.

Until that extension is implemented, prefer **flow machine** steps or **navigation** for rare one-offs, and keep terminal screens on the predefined list above.

## Machine vs screen actions

| Use                                                   | When                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Machine** (`usePaymentFlowMachine` + step handlers) | Multi-step flows: scan → parse → options → amount → mint → confirm → navigate to terminal screen.             |
| **`useScreenActions`**                                | One screen, one entry, discrete user actions (copy, pay, redeem, cancel) with centralized availability rules. |

Avoid ad-hoc hooks per screen; compose **screen actions** + **mint info** (or other read-only data) at the screen boundary.

## Flow screens: `isExecuting` with `useExecutionState`

For any screen that uses **`usePaymentFlowMachine`**, subscribe to execution state with **`useExecutionState`** (from `coco-payment-ux/react`). It wraps the machine’s `subscribe` / `inspect` API with `useSyncExternalStore` so UI stays in sync.

```tsx
import { useExecutionState, usePaymentFlowMachine } from 'coco-payment-ux/react';

const machine = usePaymentFlowMachine({ walletContext, unit });
const { isExecuting } = useExecutionState(machine);
```

**`isExecuting`** is the flag you use for **global** loading while the machine is doing work: spinners on amount/mint routes, disabling rows in mint lists, blocking double-taps while navigation or async **operations** run.

**When it is `true` (typical):**

- The machine is awaiting an **async step handler** (e.g. router navigation) for a step that is **not** treated as pure “user typing” input.
- **`operations`** are in flight (`executeSend`, `executeMintQuote`, `buildMintListItems`) — the machine sets executing for the duration.

**When it stays `false` during handler work:** Steps like **`enterAmount`**, **`selectMint`**, **`chooseOption`**, and **`chooseProofs`** are **input** steps — the machine does **not** flip the global executing flag while their handlers run, so you do not get a full-screen spinner while the user is entering an amount or picking options (per `INPUT_STEPS` in the implementation).

**What else is on the snapshot:** `useExecutionState` returns the full **`ExecutionState`** (`status`, `code`, `step`, `isExecutable`, `message`, `isExecuting`, …). Use `isExecuting` for loading chrome; use `status` / `message` if you need to reflect blocked or needs-input states in the same component.

**Not the same as screen actions:** Terminal/detail screens driven by **`useScreenActions`** use **`actions.<name>.loading`** per button (copy, pay, etc.). Use **`isExecuting`** only for **flow-machine** screens and shared UI (popups, sheets) that hold a **`machine`** reference.

## Minimal pseudocode

**App root**

```tsx
<CocoPaymentUXProvider
  handlers={walletStepHandlers}
  operations={walletOperations}
  notifications={walletNotifications}
  actions={walletActions}
  savePreferredMint={(mintUrl) => mintStore.setSelectedMint(pubkey, mintUrl)}
  saveNpcMint={async (mintUrl) => {
    await npcMintStore.updateServerMint(mintUrl, privateKey);
  }}
  onNpcMintSync={async () => npcMintStore.syncFromServer(manager)}
  clipboardSource={() => Clipboard.getStringAsync()}
  shareSource={(payload) => Share.share(payload)}
  cameraPermissionsSource={() => Camera.requestCameraPermissionsAsync()}
  imagePickerSource={() => ImagePicker.launchImageLibraryAsync(/* … */)}>
  <App />
</CocoPaymentUXProvider>
```

**Terminal screen**

```tsx
function SendTokenScreen({ sendHistoryEntry }) {
  const { entry, error, actions } = useScreenActions('sendToken', sendHistoryEntry);

  if (error) return <ErrorState message={error} />;
  if (!entry) return <LoadingState />;

  return (
    <>
      <HistoryDetails entry={entry} />
      <ButtonHandler
        buttons={[
          {
            text: 'Copy',
            onPress: () => actions.copy.execute(),
            condition: actions.copy.available,
          },
          // …
        ]}
      />
    </>
  );
}
```

## Related implementation files

For aligning code with this guide:

- `src/react/CocoPaymentUXProvider.tsx` — root provider (flat props); nested-config API removed
- `src/react/useExecutionState.ts` — subscribe to `ExecutionState` (`isExecuting`, …)
- `src/react/useScreenActions.ts` — **`useScreenActions(screenType, entryParam)`**; reads handlers + optional **`screenActionsBridge`** from context; **`useScreenActionsWithConfig`** for advanced/tests
- `src/react/screenActionsBridge.ts` — **`ScreenActionsBridge`** type for wallet injection
- `src/machine/createMachine.ts` — `createPaymentMachine`
- `src/screen-actions/*` — action manager, availability, types

In **Sovran**, **`features/send/providers/CocoPaymentUX.tsx`** composes **`CocoPaymentUXProvider`** with handlers, operations, persistence, **`actions`**, and **`screenActionsBridge`** (manager, Nostr DM helper, camera permission, history/melt subscriptions, entry decoration, scan provenance). Screens import **`useScreenActions`** from **`coco-payment-ux/react`** only—no app-level wrapper hook. The amount flow passes a **third** argument **`{ amountConfig }`** for **`amountEntry`**.
