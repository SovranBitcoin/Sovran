# Cashu mint-preference backport (W12)

`@cashu/cashu-ts@5.0.0-rc.4` drops NUT-18 `mp` when decoding or re-encoding a
request. The patch adds an optional ninth positional constructor parameter,
`mintsPreferred`, the raw `mp` field, NUT-26 TLV tag `0x09`, and declarations.
It changes the published ESM entry used by both native platforms and Node.
It leaves the installed constructor's first eight arguments intact.

References: [NUT-18](https://github.com/cashubtc/nuts/blob/main/18.md),
[NUT-26](https://github.com/cashubtc/nuts/blob/main/26.md), upstream
[cashu-ts main PaymentRequest.ts, `mintsPreferred`](https://github.com/cashubtc/cashu-ts/blob/main/src/model/PaymentRequest.ts).
Removal trigger: a cashu-ts release containing `mintsPreferred` accepted by
coco-core. Recheck the upstream constructor signature when upgrading.

## Receive limitation

Coco 2.0.0 `PaymentRequestReceiveOperationService.validatePayload` rejects both
untrusted mints and mints outside `operation.mints` before receiving proofs
(installed `dist/index.js`, lines 2050–2051). The payment-request receive UI has
no add-mint-to-claim recovery. Both receive producers explicitly set
`mintsPreferred: false`, even if a future/older profile has the preference set
true. Preferred is visible and disabled with an explanation. The e2e scenario
checks that explanation, selects Required, and copies; enabling Preferred and
exercising a successful toggle is deferred until claim recovery is implemented.
No simulator or funded scenario was run.

Coco's outgoing parser also treats `m` as strict. The wallet adapter removes
only an advisory list from its private input copy for HTTP/in-band preparation.
The original request remains the flow identity; amount, unit, transport and
NUT-10 constraints remain intact. NutDrop callers retain strict defaults and the
five-mint advertisement cap.

## Main-checkout handoff

The worktree's shared `node_modules`, lockfile and installed packages were not
modified. The patch file and root registration are prepared, **not installed**.
After integrating this commit, run the following in the main checkout while
other workers are not using its dependency tree. These commands assume the
installed SDK is still unpatched; stop if `git apply --check` fails rather than
force-applying or resetting another worker's changes.

```sh
cd /Users/kelbie/Documents/GitHub/Sovran/sovran-app
bun patch '@cashu/cashu-ts@5.0.0-rc.4'
git apply --check --directory=node_modules/@cashu/cashu-ts app/patches/@cashu+cashu-ts+5.0.0-rc.4.patch
git apply --directory=node_modules/@cashu/cashu-ts app/patches/@cashu+cashu-ts+5.0.0-rc.4.patch
bun patch --commit node_modules/@cashu/cashu-ts --patches-dir app/patches --ignore-scripts
git diff -- package.json bun.lock app/patches
```

Inspect Bun's generated patch filename/registration and reconcile it with the
reviewed patch, retaining one registered patch for this version. Review the
lockfile update; do not use a frozen-lockfile install against the prepared but
unrefreshed lockfile. `--ignore-scripts` avoids unrelated lifecycle work.

Then verify the installed dependency and integrated workspaces:

```sh
cd /Users/kelbie/Documents/GitHub/Sovran/sovran-app/wallet
bun run test -- payment-request annotate transitions standing default-operations mint-selection mint-list-enrichment
cd ../app
bun run test -- nutCreq creqMintSelection persistSchemaDrift persistRoundTrip persistedEnumTolerance filtersScreen --runInBand
bun run e2e:validate
bun run lint
bun run check:styling
cd ..
bun run type-check
git -c core.whitespace=-space-before-tab,cr-at-eol diff --check
```

## Worktree validation

The committed patch passed `git apply --check` and was applied to detached copies
of the two published files under `wallet/.w12-sdk`, never to `node_modules`.
Temporary Vitest/Jest aliases and TypeScript paths selected that copy and this
worktree's wallet sources. The temporary files were removed after verification.

- Wallet: **220 tests passed across 10 files**, covering both codecs, true/false/
  omitted `mp`, an independently encoded tag-09 vector, unknown-tag tolerance,
  strict behavior, preferred routing/ranking, amountless and single-use
  re-encoding, the legacy outgoing adapter and mint-list enrichment.
- App: **130 tests passed across 6 suites; 36 snapshots passed**, including
  legacy/corrupt preference hydration, data-only round trips, disabled segment
  accessibility, NutDrop strict defaults and the unchanged mint-selection tests.
- Detached wallet, iOS and Android TypeScript checks: **exit 0**, no output.
- Ordinary app tests against the unpatched SDK: **111 passed, 1 failed**;
  `nutCreq`'s new explicit-preference test receives `undefined` instead of `true`.
- Ordinary wallet command cannot start because Vite writes `.vite-temp` under
  the shared dependency symlink. A temporary runner config with its cache in
  `/tmp` ran against the unpatched SDK: **132 passed, 7 failed**, all seven new
  codec/preference cases requiring the patch.
- Ordinary root type-check remains blocked by the unpatched SDK declarations
  and app imports resolving the main checkout's wallet source via its workspace
  symlink. The detached path overrides passed both platforms; they do not
  certify that the unapplied main-checkout installation is ready.

The additive schema snapshot change is intentional. No persisted enum changed;
the existing enum-tolerance suite was also run. Native layout, screen-reader
behavior and live settlement remain unverified under the task's no-device rule.

## Files changed

- `SYSTEM.md`
- `app/__tests__/__snapshots__/persistSchemaDrift.test.ts.snap.node`
- `app/__tests__/filtersScreen.test.tsx`
- `app/__tests__/nutCreq.test.ts`
- `app/__tests__/persistRoundTrip.test.ts`
- `app/e2e/scenarios/receive-payment-request-sat.json`
- `app/features/receive/components/CreqCustomizationCard.tsx`
- `app/features/receive/components/ReceivePaymentRequestTab.tsx`
- `app/features/receive/screens/ReceivePaymentRequestQuoteScreen.tsx`
- `app/features/receive/screens/ReceiveScreen.tsx`
- `app/patches/@cashu+cashu-ts+5.0.0-rc.4.patch`
- `app/patches/README.cashu-mints-preferred.md`
- `app/shared/blocks/PaymentInfo.tsx`
- `app/shared/lib/nutCreq.ts`
- `app/shared/lib/qr.ts`
- `app/shared/stores/profile/mintStore.ts`
- `app/shared/ui/composed/PillTabs.tsx`
- `app/shared/ui/composed/QRCode.tsx`
- `package.json`
- `wallet/__tests__/unit/annotate.test.ts`
- `wallet/__tests__/unit/default-operations.test.ts`
- `wallet/__tests__/unit/payment-request-codec-contract.test.ts`
- `wallet/__tests__/unit/standing-payment-request.test.ts`
- `wallet/__tests__/unit/transitions.test.ts`
- `wallet/src/annotate.ts`
- `wallet/src/formatting/locales.ts`
- `wallet/src/machine/contextResolution.ts`
- `wallet/src/machine/resolveNext.ts`
- `wallet/src/machine/transitions.ts`
- `wallet/src/machine/types.ts`
- `wallet/src/mint-capabilities.ts`
- `wallet/src/mint-selection.ts`
- `wallet/src/operations/defaultOperations.ts`
- `wallet/src/payment-request-receive.ts`
- `wallet/src/payment-request.ts`
- `wallet/src/react/useStandingPaymentRequest.ts`
- `wallet/src/types.ts`

Ordinary lint finished with **0 errors and 142 warnings**. All warning locations
are in unchanged files. Styling reported **no new debt**; e2e validation passed.
The ordinary staged whitespace check flags the patch's context-prefix spaces
before upstream tabs and the upstream declaration's CRLF endings. Preserving
those bytes is necessary for reproducible application. The patch-aware command
above passed; ordinary source-file whitespace checks also passed.
