# 25. On Android, a flow is a pushed screen unless it is a menu

Date: 2026-10-06
Status: Accepted

iOS presents Send, Receive, mint details and transaction detail as page sheets.
Android copied that with a full-height native bottom sheet
(react-native-screens `formSheet`), dragged down to dismiss.

That is the wrong surface on Android for most of them. Material reserves a
modal bottom sheet for a menu or a simple choice
([component guidance](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md));
a task with several steps is a screen, or a full-screen dialog
([dialogs](https://github.com/material-components/material-components-android/blob/master/docs/components/Dialog.md)).
A full-height sheet also puts drag-to-dismiss on top of scrolling content: the
sheet starts dragging once the list reaches its top, so a downward fling on a
payment flow can discard it. And no native header renders inside an Android
form sheet (react-native-screens #2657), so every sheet flow carried a JS
header, a fixed-height frame and a scrim to imitate one.

- **Pushed by default.** On Android a flow group or standalone payment route
  slides in from the right and is left with Back. It uses the native header,
  with the app's back button on its first screen as well as later ones.
- **Sheets for menus.** `(filter-flow)`, `(prompt-flow)` and `share` stay bottom
  sheets: a person picks or confirms and leaves, with no step after.
- **One owner.** `config/androidFlowPresentation.ts` holds the list.
  `config/modalScreens.ts` reads it to present the route;
  `AndroidSheetFlowStack` and `FormSheetChrome` read it to choose the chrome.
  A test checks every flow layout names its own route group, so the two halves
  cannot disagree.
- **iOS is unchanged.**

What this does not give: predictive-back animation inside the app.
react-native-screens 4.x does not implement it
([discussion #2540](https://github.com/software-mansion/react-native-screens/discussions/2540));
Back commits without the preview. That needs the experimental stack, which has
no modal or form-sheet presentation yet.

Reviewed on an Android 16 emulator for Send, Receive, amount entry, the
transaction list and transaction detail. Not yet reviewed there: mint details,
the map, the theme picker and the profile flow, which changed with them.
