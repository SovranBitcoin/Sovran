# Lens: dismiss parity (button vs gesture teardown)

Scope: every modal, sheet, and pushed screen with cleanup — payment flows,
composer, pickers, action menus. The core defect class: **teardown wired to
the button path only.** Any state mutation living in an `onClose`/back-button
`onPress` that does not also run on swipe-back or drag-down dismissal is a
latent bug — the flow "works" until a user dismisses by gesture and the state
machine is left mid-flight.

## The rule

Route all teardown through screen-lifecycle events, which fire for button,
swipe-back, and drag-down alike: `beforeRemove`, unmount cleanup,
`useFocusEffect` cleanup, native-stack `transitionEnd` with `e.data.closing`.
Button handlers should only *initiate* dismissal (`router.back()`,
`sheetRef.close()`) — never carry the cleanup themselves.

## Detection protocol

1. `rg -n "router\.back\(\)|goBack\(\)|dismiss\(\)" features app` — for each
   call-site doing more than navigate (store writes, machine sends, resets),
   ask: what runs when the user swipes instead? If nothing: finding.
2. Sheets: `@gorhom/bottom-sheet` teardown must live in
   `onChange(index === -1)` / `onClose` as the **single** source; the close
   button merely calls `close()`. Detect: cleanup in the button handler with
   `onClose` absent or divergent.
3. `visible` booleans / state machines that only transition on an explicit
   close call: iOS `pageSheet`/`formSheet` swipe-dismiss historically bypasses
   JS close callbacks (RN #26892 class) → `visible:true` desync. Detect: RN
   `Modal` with `presentationStyle` sheet variants; screens formSheets rely on
   their own event surface (`sheetDetentChange`).
4. `usePreventRemove`/`beforeRemove` coverage limits: covers back button,
   swipe, `pop`/`reset` — NOT tab switches, conditional unmount, app kill.
   Confirm-discard flows relying solely on it with `gestureEnabled` need a
   draft-persistence fallback (the sanctioned alternative: persist drafts
   instead of blocking).
5. Gesture parity inverse: `gestureEnabled:false` screens need a visible exit
   affordance; `gestureEnabled:true` screens must not hide side effects
   exclusively in the header back `onPress`.
6. Completion logic in animation callbacks: under reduced motion, exit
   animations are skipped and callbacks may not fire — dismissal state
   transitions must not depend on them (cross-check animations lens).

## Known repo classes (don't re-report; hunt new instances of the shape)

- Receive back-nav dead Next — fixed via popup `openSeq` nonce +
  `sendLocked` supersede. The *shape* (stale in-flight async re-arming a
  dismissed surface) generalizes; look for it in other popups.
- Android formSheet dismiss needs `nestedScrollEnabled` drag-at-top.
- actionMenu chaining requires `keepOpen:true` (closing then reopening races).
- Payment flows: root-entry reset contract is owned by the Colada machine —
  judge whether *dismissal* paths reach the machine's reset, under the
  state-machines lens.

## Evidence

```bash
rg -n "onClose|onDismiss|onRequestClose" features shared
rg -n "beforeRemove|usePreventRemove|gestureCancel|sheetDetentChange" features app
rg -n "gestureEnabled" app features
rg -n "router\.back\(\)" features app -A 3     # inspect what else the handler does
npx tsx codereview/log-doctor/index.ts errors --latest --context 5
```

Best confirmation is a traced scenario: "open X, swipe to dismiss, reopen —
state Y is stale." If you can't articulate that trace, the finding is
PLAUSIBLE at best.

## Do not flag

- Cleanup intentionally deferred to flow completion (payment success screens
  that outlive dismissal by design — check STATE_MACHINE.md first).
