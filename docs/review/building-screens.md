# Building a screen

Sovran has one look. A new screen should be indistinguishable from the ones around it, which
means it is assembled from the parts they use, not designed fresh.

## Before writing any UI

1. **Open the nearest existing screen of the same kind and read it.** Build yours from the same
   parts in the same order.

   | Building | Read first |
   | --- | --- |
   | Settings page: rows, toggles, a selection | `app/features/settings/screens/SettingsNotificationPolicyScreen.tsx` |
   | Form or picker with footer buttons | `app/features/transactions/screens/FiltersScreen.tsx` |
   | Detail page with an identity header | `app/features/ai/screens/ProviderInfoScreen.tsx` |
   | List | `app/features/transactions/screens/TransactionsScreen.tsx` |
   | Amount entry | `app/features/send/screens/AmountFlowScreen.tsx`, `app/shared/ui/composed/AmountEntryView.tsx` |
   | Facts about one thing, in a sheet | `app/app/details.tsx`, `app/shared/ui/composed/DetailsSheet.tsx` |
   | Blocking prompt or error page | `app/shared/blocks/CtaScreen.tsx`, `app/shared/blocks/StartupFailedScreen.tsx` |

   `SettingsNetworkScreen`, `MintInfoScreen`, `SendScreen` and `ContactsScreen` predate the
   current parts. Do not copy from them.

2. **Search for the part before making one.** `app/shared/ui/primitives`, `app/shared/ui/composed`
   and `app/shared/blocks` hold about a hundred. If one is close, extend it; a second component
   that does nearly the same thing is a defect.

   | Need | Use |
   | --- | --- |
   | Page frame, safe areas, header gradient, scrolling | `Screen`, `ScreenScrollView` |
   | Text, a tap target, a button | `Text`, `Pressable`, `Button` (the shared pill) |
   | Footer actions, including the overflow menu | `BottomButtons` with `ButtonHandler` |
   | A grouped container; a titled group | `Surface`; `Section` |
   | Settings-style rows | `ListGroup` from `heroui-native`; `ListRow`, `ContactRow` |
   | Choosing one of several | `actionMenuPopup`; `actionMenuSheet` when already inside a sheet |
   | A table of facts | `GroupedTable`, `DetailsSection` |
   | A status message | `Notice` |
   | Empty, failed or loading | `EmptyState`, `ScreenStates`, `SkeletonContentCrossfade` |
   | Header buttons, a collapsing identity | `ScreenHeaderAction`, `useIdentityHeader` |
   | Tabs | `PillTabs`, `UnderlineTabs` |

3. **Style with Tailwind classes** (Uniwind) and theme colours. `bun run check:styling` counts
   inline styles and `StyleSheet.create` per file and fails when a count rises.

## While building

- Content never jumps: a loading state has the size and shape of what replaces it. Prefer
  passing data into a screen over fetching it there, so there is nothing to wait for.
- A disabled option stays visible, dimmed, with a short reason under it.
- Wording is plain and short. If a sentence needs a protocol word, look for another sentence.
  Payment copy lives in the `wallet` copy catalogue and shared wording in `copy/`.
- Change only what the task names. Restyling a neighbour on the way past is a separate change.

## Before calling it done

Look at it running, beside its neighbours, on both platforms: Settings → Design system →
Screens opens every state on fixed data, and mock mode fills the app without a wallet. A
screenshot that looks out of place is a failed check, the same as a failing test. If only one
platform was looked at, say so.

## Exploring a new design

When the owner asks for options, add them to
`app/features/settings/design-system/variations/` as whole, structurally different takes on
one component (not recolours), named by code so he can pick one. The pick is then rebuilt into
the real component and the others are deleted. Do not add app-level styles or theme switches.

Contracts that go further: [headers](header-contract.md), [menus inside sheets](modal-menu-contract.md),
[navigation](../protocols/navigation-and-routes.md),
[React Native conventions](conventions-react-native.md).
