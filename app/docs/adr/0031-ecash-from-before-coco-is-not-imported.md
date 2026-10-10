# 31. Ecash from before Coco is not imported

Date: 2026-10-10
Status: Accepted.

Builds 0.0.1 to 0.0.40 (iOS, April 2024 to August 2025) kept ecash in one
redux-persist row, `persist:SOVRAN`. Release 0.0.45 imported that row into Coco;
the importer was removed in 0.1.2. A phone that upgrades straight from one of
those builds to 0.1.2 or later therefore has no importer to run.

We do not bring the importer back. Those builds were early test builds, the
importer has been gone since 0.1.2 and 0.1.3 without a report, and restoring it
means changing wallet startup for every user to serve an install that may not
exist, with no device of that age to prove it on.

What the app does instead, and must keep doing:

- The recovery phrase in the old row is adopted as the wallet's phrase. The app
  never generates a new one over it, and locks if the row cannot be read.
- The row is never written or removed, so an importer can still be added.
- The user is offered a restore from their mints. It recovers ecash made by
  0.0.12 build 10 and later. Earlier builds seeded Cashu with the raw child
  key, so their ecash can only come from the old row.

Reopen this if App Store Connect shows active devices below 0.0.45, or if
anyone reports a balance missing after such an upgrade.
