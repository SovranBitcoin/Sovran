# Lens: UX status & feedback conventions

Scope: async mutations (payments, posting, follows, zaps), error surfaces,
haptics, touch targets. This is the code-verifiable subset of usability
heuristics — flag only what can be shown from code, not taste.

## Visibility of system status

- Every async mutation needs all three states reachable in code: pending,
  success, error. Detect: mutation call-sites where the error branch only
  `console.log`s or is absent; optimistic updates with no reconciliation/undo
  path when the network settles differently (repo precedent:
  `ownContentStore` is the authoritative optimistic-posting pattern — new
  optimistic surfaces should match it).
- Pending affordances must appear fast but not flicker: sub-300ms operations
  shouldn't flash a spinner (content-shift lens owns skeleton parity; here,
  judge *status truthfulness*).
- Success shown before the operation actually lands is a lie — especially
  payments: the timeline/status UI must reflect machine state, not button
  taps (cross-check state-machines lens).

## Error recovery

- Error states carry a retry action, not just a toast. Detect: catch blocks
  surfacing `Alert`/toast with no retry affordance on flows the user can't
  re-enter cheaply.
- Destructive/dismiss paths are cancelable; confirm-discard belongs to
  draft persistence where possible (dismiss-parity lens owns the gesture
  coverage).
- Disabled-until-valid beats post-hoc validation alerts. Detect: submit
  handlers opening validation alerts for statically-checkable invalidity.

## Haptics vocabulary (expo-haptics)

- `notificationAsync(Success/Warning/Error)` = outcome of a completed task
  (payment settled/failed). `impactAsync` = physical collision (snap, drag
  catch). `selectionAsync` = picker/segment change. Detect: success haptic
  fired at tap time rather than on confirmation; impact used for outcomes.
- Haptics accompany visual feedback, never replace it (Taptic no-ops in Low
  Power Mode). Detect: state changes whose only feedback is a haptic.

## Touch targets & accessibility basics

- ≥44×44pt effective hit area — `hitSlop` counts. Detect: icon-only
  `Pressable`s with small fixed dims and no `hitSlop`; adjacent small targets
  without separation.
- `allowFontScaling={false}` needs justification per use.
- State conveyed by color alone (online dots, error borders) needs a second
  channel.
- Known repo classes (hunt new instances, don't re-report): heroui Ripple
  stealing taps from RNGH (glass buttons need an RN View responder); status
  testIDs riding card Pressables because inner probes get AX-flattened.

## Evidence

```bash
rg -n "notificationAsync|impactAsync|selectionAsync" features shared
rg -n "hitSlop" features shared            # inverse: small Pressables without it
rg -n "allowFontScaling" features shared
rg -n "catch" features --type tsx -A 2 | rg -i "toast|alert"
npx tsx codereview/log-doctor/index.ts errors --latest --context 5
```

## Do not flag

- Copy/wording quality (owner: landing-copy / product voice, not this lens).
- Missing accessibility labels wholesale — only flag where an interaction is
  *unusable*, not merely unlabeled (a dedicated a11y audit owns the rest).
