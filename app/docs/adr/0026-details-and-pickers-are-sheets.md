# 26. Details and short pickers are sheets; a footer never repeats the header

Date: 2026-10-06
Status: Accepted

## Context

Every flow screen has a header control that leaves it: a close on the first
screen, a back arrow after. Many screens also carried a footer "Cancel" or
"Close" that called the same `goBack`. The slot it took is the most reachable
one on the screen.

A payment's technical facts (ids, quote, mint, state) sat behind a collapsed
inline list at the bottom of the page: easy to miss, and its values could not
all be copied.

On iPhone the mint selector was a full page pushed inside the flow's modal, so
choosing a mint hid the amount being entered.

## Decision

- **A footer button does something the header does not.** Where a footer
  "Cancel"/"Close" only went back, it is removed or replaced. A button that
  ends something real stays: rolling back a send, releasing reserved proofs,
  stopping a recovery, declining a mint.
- **Details open in a sheet.** `DetailsSection` no longer expands in place. Its
  row, or a footer "Details" button through `open`/`onOpenChange`, opens
  `DetailsSheet`: the system page sheet on iPhone, a full page on Android. The
  content is a `GroupedTable`. A row whose value is text copies it on tap, and
  "Copy all" copies every such row. Confirmation is drawn in the sheet, because
  the app's toasts sit beneath a system sheet.
- **`GroupedTable` is the table for facts and settings**: a small heading, one
  framed group of label and value rows split by hairlines, optional action
  rows. Its frame is the active style's surface.
- **The iPhone mint selector is a system form sheet**
  (`MINT_SELECT_SCREEN_OPTIONS`): a little over half height with a grabber,
  full height when pulled. It is the same route and screen, so the payment
  flow, selectors and probes are unchanged. As a flow's first screen it stays
  a page. Android keeps the pushed page (ADR 0025).

## Amendment, 2026-10-08: Details is a route

The Details sheet was React Native's `Modal`. It is now a route,
`app/details.tsx`, registered in `config/modalScreens.ts`: the system page
sheet on iPhone, a pushed page on Android. A route's params are strings and a
detail value can be an element, so the opener hands the rows over through
`detailsSheetStore` (runtime only) and keeps them current while the modal is
up.

- **Done is at the foot**, with Copy all beside it, in the same `ButtonHandler`
  footer every other screen uses. The header "Done" is gone; on iPhone the
  sheet is still pulled down, on Android Back still works.
- **The table is split in two** when it has both kinds of row: the short facts
  a person reads, then "References" — the long strings they only copy.
- **Details gives up its footer slot.** A footer button marked
  `prefersOverflow` is listed behind the three dots whenever two other buttons
  are showing, and takes the free slot when they are not. Lightning and
  on-chain receive now show Copy and Share, with Details behind the dots.
- `DetailsSection` keeps `open` / `onOpenChange`, but `open` is now a request:
  the modal closes itself, so `onOpenChange(false)` fires once it is presented.
- **Details is always a footer button.** No screen draws a Details row in the
  page any more; all seven detail screens open it from the footer, where it
  gives way to the screen's own actions.
- **Every row copies.** A value that is drawn rather than written (the
  payment-method icons) carries `copyText`, and every detail list ends with
  the shared debug rows (`debugDetailItems`: id, operation, quote, type,
  state, unit, mint, last change, error). A screen's own wording for one of
  those wins; the duplicate is dropped.
- The page uses the app's standard header and the screen wrapper's own
  gutter, with no second inset.
- **The page is grouped by what a row is about**, in a fixed order: Payment,
  People, Lock, Token, Mint, References, Debug. A row names its group, or
  falls to Payment (a short fact) or References (a long string). Keys, ids,
  hashes, invoices and URLs are set in the monospace face.
- **People** carries the counterparty's name, address, `npub` and hex key. The
  bare npub that sat above the QR code on a payment's page is gone; the
  domain claim captured at payment time stays there, because that one is a
  statement about who was paid.
- **Lock** is the token's spending conditions, read from its own proofs
  (type, state, keys, signatures needed, unlock date, who can take it back,
  signature flag, what this wallet cannot do). **Token** is what the token
  says about itself: proof count, denominations, keysets, whether it carries
  DLEQ proofs (NUT-12), witnessed parts, mint, unit, memo.
- Not shown, because the history entry does not carry them: a melt's fee,
  change, preimage and outpoint (they live on coco's operation), and a mint
  quote's `amount_paid` / `amount_issued` and expiry.
- No device run yet, and no native scenario enters the page (follow-ups F65).

## Consequences

- Lightning and on-chain receive show Details, Copy, Share. The mint list has
  no footer.
- Left as they were, each for a stated reason: the unredeemed-token "Cancel"
  (kept explicit so a preview is not mistaken for accepting), and the
  "Close" buttons that seven E2E scenarios tap or that return to the wallet
  rather than one step back.
- The sheet is React Native's `Modal`. `@expo/ui` (installed) offers SwiftUI
  `List` and `BottomSheet` with detents; it has no Jest mock here and its
  hosted rows size once at mount, so it was not used. It is the next step if
  the page sheet's fixed height proves wrong for short tables.
- Fast Refresh does not repaint an open `Modal`; reopen it.
