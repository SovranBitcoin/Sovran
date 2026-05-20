# Flow screens — the rules

The app organizes screens into Expo Router groups that present as **modal stacks** from the parent layout. Each top-level group (`(settings-flow)`, `(receive-flow)`, `(send-flow)`, `(mint-flow)`, `(profile-flow)`, `(split-bill-flow)`, `(filter-flow)`, `(map-flow)`, `(stories-flow)`) is its own modal that slides up from the bottom; nested screens within the group push horizontally with the standard close/back header.

## Nostr profile flow choice

Use `(user-flow)` for normal flat profile navigation from Contacts, Feed, search, and other tab-level surfaces. It is registered as a side-slide stack so profile browsing feels like a lateral detail view.

Use `(profile-flow)` when opening a Nostr profile from camera scanning or from inside another modal flow. This keeps the profile above the active modal stack instead of opening as a sibling behind it. Profile-internal actions such as Share and Nostr DM must route through `shared/lib/nav/profileRoutes.ts` so they stay inside whichever profile flow is currently active.

## The four-file pattern for adding a screen to a flow

A new screen is **never** just a route file. Adding `Foo` to the settings flow means:

1. **Screen component** at `features/<feature>/screens/Settings<Foo>Screen.tsx` — the actual UI. Wrap in `<Screen name="...">` from `@/shared/ui/composed/Screen` (commonly aliased as `ScreenWrapper`). The wrapper props vary by layout shape — see "Picking the Screen wrapper shape" below.
2. **Barrel export** in `features/<feature>/index.ts` — `export { Settings<Foo>Screen } from './screens/Settings<Foo>Screen';`. Routes import through the barrel, never directly from `screens/`.
3. **Route file** at `app/(<flow>)/<foo>.tsx` — a one-line wrapper:
   ```tsx
   import { Settings<Foo>Screen } from '@/features/<feature>';
   export default function FooRoute() { return <Settings<Foo>Screen />; }
   ```
4. **Stack registration** in `app/(<flow>)/_layout.tsx` — `<Stack.Screen name="<foo>" options={{ title: 'Foo' }} />`. The title shows in the modal header.

## Picking the Screen wrapper shape

The `<Screen>` props depend on what the screen contains. Three common shapes:

- **Settings-list / inventory screens** (long scrolling content, no footer CTA):
  `<Screen name="..." scroll="custom" safeArea>` followed by `<ScrollView className="px-4">`. The `safeArea` prop is required here — without it the content runs under the modal's safe-area inset. See `SettingsStorageScreen`, `SettingsRecoveryScreen`, `SettingsRoutingScreen` for canonical examples.
- **Action screens with a footer CTA** (form + a "Submit" button at the bottom):
  `<Screen name="..." contentPadding={0} footer={bottomButtons}>` where `bottomButtons` is a `<BottomButtons>` block holding the project Button. The Screen handles safe-area itself in this mode — **do not** add `safeArea`. See `MeltQuoteScreen`, `SendTokenScreen`, `WhitenoiseSetupScreen`.
- **Full-bleed screens** (camera, chat, map): `<Screen name="..." scroll="none">` — no scroll, no safe area, the screen owns its own insets.

If you're not sure which shape fits, find the closest existing screen in the same feature and copy its wrapper line.

## Linking to it from the parent screen

Settings entries use the inline `SettingsListLinkItem` defined at the top of `SettingsScreen.tsx`. Pattern:

```tsx
<SettingsListLinkItem href="/(settings-flow)/foo" title="Foo" description="Optional second line" />
```

The `href` must include the group name in parens — `(settings-flow)/foo`, not `/foo`. Other flows have their own list-item primitives or are entered from app actions (`router.push('/(receive-flow)')`); check the flow's existing screens for the entry pattern.

## Layout inside the screen

- **Sections:** `<Card variant="secondary" className="mb-4"><Card.Body className="gap-X">` with `gap-3` / `gap-4` Tailwind classes for vertical rhythm. Eyebrow labels are `<Text size={11} bold className="text-foreground/50 tracking-widest">SECTION</Text>`.
- **Tailwind classes for layout, not inline styles.** `className="px-4 mb-4 gap-3"` not `style={{ paddingHorizontal: 16, marginBottom: 16, gap: 12 }}`. Inline styles are only for values that come from runtime data (an animated color, a measured width).
- **Theme colors via Tailwind utility classes** (`text-foreground/60`, `bg-surface-secondary`) before reaching for `useThemeColor`. Reach for the hook only when you need the value as a runtime string (passing to a non-className API like an SVG `fill` or a Reanimated `interpolateColor`).
- **Buttons:** for in-card actions and segmented choices use heroui Button; for the screen's primary footer CTA use the project Button inside `<BottomButtons>`. See [`buttons.md`](./buttons.md).

## Don't

- ❌ Use `safeArea` together with `footer={bottomButtons}` — the footer mode handles safe area itself; doubling up double-pads the bottom.
- ❌ Skip `safeArea` on a `scroll="custom"` settings-flow screen with no footer. The modal's top-edge safe area sits behind the navigation header.
- ❌ Put the screen component in `app/`. Routes are thin re-exports; the implementation lives under `features/`.
- ❌ Forget the barrel export. The route file imports through `@/features/<feature>`, not `@/features/<feature>/screens/...`.
- ❌ Forget the layout entry. The screen will render but won't get the title/header configuration the rest of the flow expects.
