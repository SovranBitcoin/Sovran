# Navigation and routes

Expo Router, file-based, under `app/app/`. One root `Stack` holds the drawer (which holds the
tabs) and, beside it, every flow and standalone route. `app/config/modalScreens.ts` is the
table of those root entries and how each one presents.

## Why a journey lives in a `-flow` group

A flow group such as `(send-flow)` is **one entry in the root stack with its own nested stack
inside**. The root presents the group once; every step after that is a push inside it.

- **On iPhone** the group is a page sheet (`presentation: 'modal'`). Steps slide sideways
  inside that one sheet. Navigating to a route _outside_ the group adds a second root entry,
  which opens as a second sheet on top of the first, or underneath the page you are on.
- **On Android** the group is a pushed page with the native header
  ([ADR 0025](../../app/docs/adr/0025-android-flows-are-pushed-screens.md)). The nested stack
  is still what makes the journey one unit that Back leaves step by step.

So when a screen needs a next step, **add the step to the group you are already in**. If the
step exists elsewhere, give this group its own thin route file for it. That is why `sendToken`,
`lightningSend`, `onchainSend`, `receiveToken`, `lightningReceive`, `onchainReceive` and
`paymentRequest` each exist at the root, in the send or receive flow, and in the transactions
flow: one feature component, three thin wrappers, and the caller pushes the copy inside its
own flow.

| Group | iPhone | Android |
| --- | --- | --- |
| send, receive, transactions, mint, ai, map, theme, profile | page sheet | pushed page |
| filter, prompt (and the standalone `share`) | page sheet | bottom sheet |
| settings, signer, user | pushed page | pushed page |
| stories | full screen | full screen |

Android's three sheets are listed in `app/config/androidFlowPresentation.ts`. Details and
pickers are sheets on iPhone and pages on Android
([ADR 0026](../../app/docs/adr/0026-details-and-pickers-are-sheets.md)). A menu opened from
inside a sheet needs a host above it: [modal menu contract](../review/modal-menu-contract.md).
Headers: [header contract](../review/header-contract.md).

## Entering and leaving

- **Enter a payment flow** with `clearPaymentContext(reason)` and then
  `machine.startSend({ reset: true })` or `startReceive`. The payment machine navigates, not
  the screen (`app/features/send/lib/sovranPaymentConfig.ts`).
- **Step back** with `router.back()`. The first screen of a sheet shows a close button and
  later screens an arrow; both go back.
- **Finish** with `dismissTo('/')`. `dismissAll()` only returns to the flow's first screen.
- **Return to a screen already open underneath** with `dismissTo(href)`. `navigate` would
  stack a second copy.

Navigate through `guardedRouter` (`app/shared/hooks/useGuardedRouter.ts`); lint rejects
`router` from `expo-router`.

## Adding a route

1. The route file under `app/app/`, which only re-exports a screen from `app/features/`.
2. A `Stack.Screen` in the group's `_layout.tsx`, or an entry in `MODAL_SCREENS` for a root
   route.
3. `app/shared/lib/nav/featureRoutes.ts` if the feature can be switched off in a build
   ([ADR 0021](../../app/docs/adr/0021-a-build-chooses-its-modules.md)).
4. `CANONICAL_PAGES` and `PAGE_ROUTES`, so the native harness can reach it.

The screen reads its params through `useRouteParams` (`app/shared/lib/nav/useRouteParams.ts`),
which validates them and goes back on bad input. Pass identifiers, not objects.
