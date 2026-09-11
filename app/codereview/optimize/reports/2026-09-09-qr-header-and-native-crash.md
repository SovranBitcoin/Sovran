# QR Display presentation and native crash follow-up

## Presentation changes

- QR Display uses `ScreenHeaderAction` and `withGlassHeaderItems`, matching the app's other native header actions. At the user's request the center now follows the selected unit using the wallet chooser's shared 24-point icon: the Bitcoin disc or the USD/EUR/GBP flag. The fixed circular header geometry, iOS shared-background suppression and working sheet tap handler are retained.
- The account chooser now uses `actionMenuSheet`, whose `PopupHost` presents above native route modals. The earlier `actionMenuPopup` path deliberately disables FullWindowOverlay and rendered below the receive flow on iOS. The receive machine's guarded currency selection is unchanged.
- A later tap regression was caused by disabling the header when only the current unit was available. The device log at 19:40:04 UTC reports `units: sat`; the same state reproduced a disabled header in the test. The header always opens the chooser and uses the same available-unit filter as Home. The temporary override offering every currency has been removed. Availability uses trusted mint metadata and keysets, with the existing Bitcoin baseline and held-balance retention policy. Its checkmark follows the receive route's displayed currency, including when the global active-unit hook falls back to Bitcoin. The ordinary balance pill retains its mint-supported options and disabled state when no other account is available. Regression coverage checks Bitcoin-only and mixed available-unit menus, selection callbacks, and switching Bitcoin back to USD without leaving its address or Copy action available.
- Shared copy rows constrain the text column to the available layout width, preserve both icon columns, and use single-line middle ellipsis. This adapts to container width and font scaling without estimating character widths or changing copied values.
- Payment request, BOLT12 and onchain list loading now uses the canonical spinner, with the fabricated row skeleton removed.

## Native crash evidence

Read-only retrieval from the attached iPhone found `Sovran-2026-09-09-200158.ips`. At 20:01:55 BST the process terminated with `EXC_BAD_ACCESS / SIGSEGV`. The triggered SQLite queue was in `pthread_mutex_lock → exsqlite3_reset → SQLiteModule.run`. Another SQLite queue was simultaneously inside `exsqlite3_close → SQLiteModule.closeDatabase`, checkpointing the WAL. This establishes native execution/closure overlap, although the report does not identify the database name or the originating JavaScript caller.

The development log shows `_layout loaded` at 19:01:55.227 UTC, immediately before the crash, without a recorded manager cleanup event in that minute. Reload-related teardown is therefore a possibility, not a proven exclusive cause. Both full-session and latest-session log redaction scans found no high-signal raw-secret matches. Raw device reports remain outside the repository at `/tmp/sovran-native-crash-2026-09-09`.

A separate `Sovran.cpu_resource-2026-09-09-195131.ips` records 90 seconds of CPU over 169 seconds and a peak footprint around 1.74 GB in the development app. It says `Action taken: none`; it is not a memory-kill report. Its unsymbolicated React/Hermes stacks do not establish a particular component as the cause. That CPU/memory pressure remains an open device-profiling item.

## Close/read race protection

The installed Expo SQLite module runs async operations on a concurrent native queue. Its connection close finalizes outstanding statements; closing while an async statement is in use can invalidate native pointers. The app now passes its Coco database through `drainSqlite`, after pre-initialization backup handling. The same protected handle is retained by `CocoManager` for cleanup.

The guard tracks Coco's complete async query helpers, rejects new calls once closing begins, awaits already-started operations, and invokes native close once. Accepted exclusive transactions retain their own live scope until completion; scoped queries are drained before Expo closes its temporary transaction connection even when the transaction callback rejects early. Ordinary independent queries remain concurrent. No SQL, persisted schema, proof selection, balances or transaction ordering policy was replaced. This boundary covers the APIs used by the installed Coco adapter; raw manually prepared statements and streaming cursors are outside that adapter contract.

Before the guard, the deterministic close-overlap harness failed three of five cases. Afterward it passes eight cases, including an actual installed Coco repository read, close deduplication, rejecting late reads, preserving query/close failures, concurrent reads, and exclusive transaction success/failure cleanup. These tests prove ordering at the JS/native boundary; they do not reproduce a native segfault or certify that every silent exit is resolved.

## Verification limits

Commit verification for the complete optimization series passed 353 app suites / 3,591 tests / 160 snapshots, 82 wallet suites / 1,207 tests, and 30 Nostr suites / 270 tests (5,068 tests total). Root typechecks, formatting, Knip, structural analysis, styling, glass-header and React Compiler checks completed successfully. Full app lint has zero errors and 136 warnings; the compiler retains 97 known bailouts across 33 files. Logs are `/tmp/sovran-commit-*.log`. Native rendering, crash recurrence and funded transfers still need device validation.

Restoring Home's availability filter passed 12 focused picker/receive-screen tests, iOS and Android typechecks, changed-file lint, formatting and diff whitespace checks. Logs are `/tmp/sovran-receive-available-units-{tests,types,lint}.log`; native interaction was not rerun.

The subsequent all-currency chooser correction passed 10 focused picker/receive-screen tests, iOS and Android typechecks, changed-file lint, formatting and diff whitespace checks. Logs are `/tmp/sovran-receive-all-units-{tests,types,lint}.log`. Native interaction was not rerun for this correction.

Final automated checks passed: 353 app suites, 3,588 tests and 160 snapshots; iOS and Android typechecks; changed-file lint with zero errors/warnings; formatting; root Knip; styling and React Compiler guards; and diff whitespace. The compiler reports 912 compiled functions and the same 97 known bailouts in 33 files. Wallet/Nostr suites and Hermes exports from the prior report were not rerun for this follow-up.

The attached phone permitted crash-report retrieval, but screenshot capture failed because its developer image/service was unavailable. No native screenshot, live transfer, device reset, app reinstall or database inspection/mutation was performed. Existing development-build native code was not rebuilt. A subsequent physical-device run is needed to confirm header appearance, modal hit testing and crash recurrence.

Verification logs are `/tmp/sovran-qr-ui-{full-tests,tests,types,lint,final-lint,styling,compiler,knip}.log` and `/tmp/sovran-sqlite-drain-{red,green}.log`.
