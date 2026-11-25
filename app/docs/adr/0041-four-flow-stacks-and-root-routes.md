# 0041 — Four flow stacks; every other page is a root route

Status: accepted
Date: 2026-11-25

## Context

`app/app` had eleven `(*-flow)` route groups. Only four hold a task whose
steps belong together in one stack: Send, Receive, a mint, and Settings. The
other seven were wrappers: `(map-flow)` (the map and one merchant),
`(theme-flow)` (the wallpaper picker), `(filter-flow)` (one page),
`(transactions-flow)` (the list, plus six copies of the payment detail routes
that already existed at the root), `(user-flow)` and `(profile-flow)` (the
same five profile pages twice, the second re-exporting the first), and
`(prompt-flow)` (a prompt and the backup it starts). Each needed its own
layout, a root entry, and, on Android, a JS sheet header, because no native
header renders inside an Android form sheet.

## Decision

- **Four flow stacks.** `(send-flow)`, `(receive-flow)`, `(mint-flow)` and
  `(settings-flow)` stay, each built on `FlowStack` (config/flowLayoutOptions):
  a page sheet whose steps push inside it on iPhone (a pushed page for
  Settings), a pushed screen on Android, the native header on both.
- **Everything else is a root route**, presented by its entry in
  `config/modalScreens.ts`: `/map`, `/detail`, `/preview`, `/background`,
  `/gallery`, `/filters`, `/transactions`, `/swap`, `/aiRequest`, `/profile`,
  `/geohashChat`, `/bitchatNetwork`, `/bitchatDM`, `/share`, `/cta`,
  `/cta-sample` and `/backup-intro` … `/backup-done`. Transaction history
  opens the root payment routes marked `historyView=1`; the feature guard lets
  a disabled rail's page open only with that marker and the row it shows.
- **A page opened from a sheet is a sheet.** react-native-screens on iOS
  pushes a card that follows a modal *beneath* the modal. So a page opened
  from inside a root sheet (a payment from the list, a merchant from the map,
  a backup step from the prompt) is a page sheet over it on iPhone, not a push
  inside it. A profile chooses by its `entry` param: `entry=sheet`
  (`buildModalProfileHref`) presents it as a sheet, otherwise it is a pushed
  page.
- **State that spans pages sits above the stack.** The backup session lives in
  `AccountScope`, resets when the last backup page closes and when Mock Mode
  changes, and reads the recovery phrase only for the session that asked.
  "Not now" and "Done" pop the journey's pages and the prompt beneath them.
  The transaction filters live in the `/transactions` route.
- **Old links keep working.** `+native-intent.tsx` rewrites a link into any of
  the seven removed groups to the same page's root path, query intact, after
  the pairing-secret check. `CANONICAL_PAGES` ids are unchanged; `PAGE_ROUTES`
  names the new files.
- **Android sheets are single routes only**: `filters`, `cta`, `cta-sample`
  and `share` (ADR 0025), drawn by `FormSheetChrome` or the prompt itself.
  The flow stacks' JS sheet header (`FlowSheetHeader`) is deleted.

## Consequences

- On iPhone, the map's merchant, a transaction's detail, the wallpaper
  picker's second page and each backup step now rise as a sheet over the page
  before instead of sliding in inside it; each shows the close button, which
  goes back one page.
- A profile's share page is the one `/share` sheet (a form sheet on iPhone, a
  bottom sheet on Android) instead of a page pushed inside the profile.
- On Android nothing changes but the backup steps, which are pushed screens
  with the native header instead of pages inside the prompt's bottom sheet.
- Not yet seen running on a device for either platform.
