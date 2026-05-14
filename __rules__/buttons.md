# Buttons — the rules

The app has **two** Button components and one Pressable wrapper, each for a different job. Picking the right one is what keeps tappable surfaces feeling consistent.

## The three primitives

| Primitive | Source | When |
|---|---|---|
| **Project `Button`** | `@/shared/ui/primitives/Button` | Hero/primary CTAs — typically the screen's main action, almost always inside `<BottomButtons>` at the screen footer. Built-in `loading` spinner, ripple, blur, haptics. |
| **heroui `Button`** | `heroui-native` | In-card actions, segmented choices, dialog actions, list-row inline actions, icon-only header buttons. Composes with the heroui Card / ListGroup / Sheet primitives. |
| **`Pressable`** | `@/shared/ui/primitives/Pressable` | Label-less surfaces — whole list rows, custom-shape cards, header icon buttons that conflict with heroui's padding. Project wrapper around RN's Pressable that adds haptics + single-flight opt-ins. |

## Project `Button` (`@/shared/ui/primitives/Button`)

The hero-CTA button. String `text` prop, built-in loading spinner, integrates with `<BottomButtons>` for the gradient-faded footer area.

```tsx
<BottomButtons>
  <Button
    text={isPending ? 'Setting up…' : 'Set up White Noise'}
    variant="primary"
    loading={isPending}
    disabled={isPending}
    onPress={onSubmit}
    testID="..."
  />
</BottomButtons>
```

- **Variants:** `primary` · `secondary` · `dangerous`. Use semantic variants, never hand-style colors.
- **Built-in loading state:** pass `loading={true}` — the button shows a spinner inside itself; you don't need to swap a spinner in or change the label (though you can do both as `WhitenoiseSetupScreen` does for clarity).
- **The footer container:** wrap in `<BottomButtons>` from `@/shared/ui/composed/BottomButtons`. It handles the safe-area inset, the bottom-fade gradient over the scrollable content, and the standard footer padding.

## heroui `Button` (`heroui-native`)

The in-card / list-action / segmented-choice button. Compose pattern with `<Button.Label>`.

```tsx
<Button variant="secondary" size="sm" onPress={…}>
  <Button.Label>Refresh</Button.Label>
</Button>
```

- **Variants:** `primary` (high-emphasis CTA) · `secondary` (default action) · `ghost` (low-emphasis, often paired with `isIconOnly`) · `danger` (destructive). Other variants exist; check heroui-native's types if needed.
- **Sizes:** `sm` · `md` · `lg`. Card-internal actions are almost always `sm`.
- **Active/inactive (segmented choice):** `variant={selected ? 'primary' : 'secondary'}`. This is the canonical pattern for "chip" rows — don't author a custom `Pressable`-based chip.
- **Equal-width row of buttons:** wrap each `<Button>` in `<View className="flex-1">` since heroui Buttons are intrinsically sized. Pair with `<HStack spacing={8}>`.
- **Icon-only:** `<Button variant="ghost" size="sm" isIconOnly onPress={…}><Icon name="…" /></Button>` — the canonical pattern for in-card icon actions (see `SettingsKeyringScreen`'s copy/QR row).
- **Disabled:** `isDisabled={true}` (note: `isDisabled`, not `disabled` like the project Button).

## When `Pressable` is right

- A whole list row that's tappable (`SettingsListLinkItem`, `ContactRow`, `ListGroup.Item` overlays).
- A card that's clickable as a whole.
- A custom-shape surface (round avatar, segmented control built from individual hit targets).
- A navigation header icon button where heroui's padding/border conflict with the header layout — e.g. `headerRight: () => <Pressable onPress={…} style={{ padding: 8 }}><Icon name="…" /></Pressable>`.

## Don't

- ❌ Build a custom-styled `Pressable` for what is conceptually a button. If it has a label and the user reads it as "tap to do X," it's a `Button`. The most common offender is "chip" components — those are `<Button variant="secondary" size="sm">`.
- ❌ Use heroui Button for the screen's primary CTA in a footer. That's the project Button + `<BottomButtons>` pattern.
- ❌ Use the project Button inside a Card or list row for a secondary action. Its built-in ripple/blur and string-prop API are tuned for hero CTAs; for in-card actions reach for heroui Button.
- ❌ Override either Button's color scheme inline. If no `variant` fits, the design needs a conversation, not a one-off override.
- ❌ Use `react-native`'s bare `<Pressable>` directly. Always use the project wrapper from `@/shared/ui/primitives/Pressable` so haptics and single-flight opt-ins compose correctly.
- ❌ Wrap `<Button>` inside `<Pressable>` to "add" haptics. Both Button components have their own press feedback.
