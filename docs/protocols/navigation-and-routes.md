# Navigation and routes

Sovran uses **Expo Router** with file-based routing under `app/app/`. The shape
is **Stack → Drawer → Tabs**, with each flow group (`(send-flow)`,
`(receive-flow)`, `(user-flow)`, …) presented as a modal over the drawer.

## Root layout

A single root `Stack` whose default route is the `(drawer)` group; modal flow
groups are siblings, configured declaratively from a `MODAL_SCREENS` table.

```tsx
// app/app/_layout.tsx
export const unstable_settings = { initialRouteName: '(drawer)' };

<Stack screenOptions={{ headerShown: false, gestureEnabled: true, freezeOnBlur: true }}>
  <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
  <Stack.Screen name="+not-found" options={{ headerShown: false }} />
  {/* modal screens (send-flow, receive-flow, user-flow, …) from MODAL_SCREENS */}
  {modalScreenElements}
</Stack>
```

The drawer (`app/app/(drawer)/_layout.tsx`) hosts one `Drawer.Screen name="(tabs)"`;
the tabs layout (`app/app/(drawer)/(tabs)/_layout.tsx`) renders the top-level
surfaces `feed / index (wallet) / contacts / notifications / ai`. Each `(*-flow)`
group has its own nested `Stack` so screens push horizontally inside the modal.

## Routes

Route files are thin — they re-export a screen from a `features/` module.
Navigation is imperative via `router.push({ pathname, params })`; the destination
reads params through `useRouteParams`, a Zod-validated wrapper over
`useLocalSearchParams` that calls `router.back()` on invalid input (important for
untrusted deep links).

```tsx
// app/features/feed/components/nostr/NoteContent.tsx
router.push({ pathname: '/(user-flow)/profile', params: { pubkey } });

// app/app/(user-flow)/profile.tsx — thin route
import { UserProfileScreen } from '@/features/user';
export default UserProfileScreen;

// app/features/user/screens/UserProfileScreen.tsx — reads + validates params
const params = useRouteParams(UserProfileParamsSchema, { where: 'user-flow.profile' });
const pubkeyParam = params?.pubkey;
```

`useRouteParams` lives at `app/shared/lib/nav/useRouteParams.ts`.
