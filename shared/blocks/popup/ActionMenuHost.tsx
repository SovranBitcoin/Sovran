/**
 * Mounts a single controlled heroui-native Menu driven by the imperative
 * `actionMenuPopup()` helper. Place once in the app root tree next to
 * `<PopupHost />` so any code path (hooks, callbacks, deep navigation) can
 * open an action menu without needing a local Trigger in scope.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, LayoutChangeEvent, Platform } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Menu } from 'heroui-native';
import {
  BottomSheetFooter,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import opacity from 'hex-color-opacity';

import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log } from '@/shared/lib/logger';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { SectionAnchorList, type AnchorSection } from '@/shared/ui/composed/SectionAnchorList';
import {
  dismissActionMenuPopup,
  useActionMenuPayload,
  type ActionMenuItem,
  type ActionMenuInput,
  type ActionMenuPrimaryAction,
  type ActionMenuSection,
} from '@/shared/lib/popup/popups/actionMenu';
import Icon from 'assets/icons';
import { MenuScrim } from '@/shared/blocks/popup/MenuScrim';

const hostLog = log.child({ module: 'actionMenuHost' });

function buildInitialValues(inputs: ActionMenuInput[] | undefined): Record<string, string> {
  if (!inputs) return {};
  const result: Record<string, string> = {};
  for (const input of inputs) {
    result[input.id] = input.initialValue ?? '';
  }
  return result;
}

/**
 * Why `BottomSheetTextInput` instead of heroui's `<Input>`:
 *
 * Gorhom's keyboard avoidance is a pull system, not a push system. It only
 * lifts the sheet when a TextInput it knows about is focused. Registration
 * happens in `BottomSheetTextInput` (gorhom): on mount it adds the input's
 * node handle to `textInputNodesRef` (from `useBottomSheetInternal`); on focus
 * it sets `animatedKeyboardState.target = nativeEvent.target`. Without that
 * target, gorhom's keyboard listener (`useAnimatedKeyboard.ts`) caches the
 * keyboard event and bails — so even with `keyboardBehavior` set, the sheet
 * never moves.
 *
 * Heroui's `<Input>` is a plain RN `<TextInput>` that doesn't touch any of
 * those refs. A wrapper that mimics the registration in JS is fragile because
 * `findNodeHandle` semantics differ between RN's TextInput and gesture-
 * handler's wrapped TextInput (which is what `BottomSheetTextInput` renders),
 * and the Fabric / new-architecture node-handle resolution doesn't always
 * line up. Using `BottomSheetTextInput` directly is the pattern gorhom
 * documents and the only reliable way to get the sheet to lift.
 *
 * Heroui's secondary-variant input styling is reproduced inline below so the
 * input looks the same as anywhere else in the app.
 */
function MenuInputField({
  input,
  value,
  isInvalid,
  onChangeText,
}: {
  input: ActionMenuInput;
  value: string;
  isInvalid: boolean;
  onChangeText: (next: string) => void;
}) {
  const [foreground, defaultBg, defaultBorder, dangerBorder, accentBorder, placeholder] =
    useThemeColor([
      'foreground',
      'default',
      'default',
      'danger',
      'accent',
      'field-placeholder',
    ] as const);
  const [isFocused, setIsFocused] = useState(false);

  const borderColor = isInvalid ? dangerBorder : isFocused ? accentBorder : defaultBorder;

  return (
    <View>
      {input.description ? (
        <Text className="text-foreground/70 mb-2 text-sm">{input.description}</Text>
      ) : null}
      {input.label ? (
        <Text className="text-foreground mb-1 text-sm font-medium">{input.label}</Text>
      ) : null}
      <BottomSheetTextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={input.placeholder}
        placeholderTextColor={placeholder}
        autoCapitalize={input.autoCapitalize}
        autoCorrect={input.autoCorrect}
        secureTextEntry={input.secureTextEntry}
        // Mirror heroui Input's secondary variant: py-3.5 px-3 rounded-2xl
        // border-[1.5px] bg-default border-default focus:border-accent.
        style={{
          paddingVertical: 14,
          paddingHorizontal: 12,
          borderRadius: 16,
          borderWidth: 1.5,
          borderColor,
          backgroundColor: defaultBg,
          color: foreground,
          fontSize: 16,
          borderCurve: 'continuous',
        }}
      />
    </View>
  );
}

/**
 * Search input rendered above the anchor bar in tabbed menus. Uses
 * `BottomSheetTextInput` (same reasoning as `MenuInputField` above) so the
 * sheet lifts above the keyboard on focus. Includes a clear button that
 * appears once the input has content.
 */
function MenuSearchField({
  placeholder,
  value,
  onChangeText,
  onClear,
}: {
  placeholder?: string;
  value: string;
  onChangeText: (next: string) => void;
  onClear: () => void;
}) {
  const [foreground, surfaceSecondary, placeholderColor] = useThemeColor([
    'foreground',
    'surface-secondary',
    'field-placeholder',
  ] as const);
  return (
    <View style={{ position: 'relative', justifyContent: 'center', marginTop: 8 }}>
      <BottomSheetTextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? 'Search...'}
        placeholderTextColor={placeholderColor}
        autoCorrect={false}
        autoCapitalize="none"
        style={{
          height: 38,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingRight: 36,
          backgroundColor: surfaceSecondary,
          color: foreground,
          fontSize: 15,
        }}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={onClear}
          hitSlop={8}
          style={{ position: 'absolute', right: 10, padding: 4 }}>
          <Icon name="mdi:close-circle" size={18} color={opacity(foreground, 0.33)} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function ActionMenuHost() {
  const payload = useActionMenuPayload();
  const isOpen = payload !== null;
  // Safe-area bottom inset. We disable heroui's `pb-safe-offset-3` via
  // `pb-0` further down (so the absolute `<BottomButtons>` footer can
  // extend edge-to-edge), so the no-footer paths must add this inset
  // back themselves — otherwise the last button row sits flush against
  // the sheet bottom and is clipped behind the home indicator on
  // iPhones with no notch / no home button.
  const insets = useSafeAreaInsets();
  // The heroui Menu sheet uses `bg-overlay` for its content background
  // (see heroui-native's bottom-sheet.styles `contentBackground`), so the
  // gradient must taper to that exact token — not `surface` or
  // `surface-secondary`, both of which read slightly off against the
  // overlay tint. `overlay` is also the color the section list's top fade
  // tapers to so rows fade into the sheet bg as they scroll past the chrome.
  const [overlay] = useThemeColor(['overlay'] as const);

  // Track whether the current open cycle received a selection so we can
  // distinguish user-pick (skip onDismiss) from overlay-tap / swipe-close (fire it).
  const selectedRef = useRef(false);
  const activeDismissRef = useRef<(() => void) | null>(null);
  // Set when an item with `keepOpen` is tapped — tells handleOpenChange to
  // ignore heroui's "close after item press" call so the chained payload
  // (set synchronously by onPress) stays visible instead of being dismissed.
  const stayOpenRef = useRef(false);

  const [inputValues, setInputValues] = useState<Record<string, string>>(() =>
    buildInitialValues(payload?.inputs)
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Search state for tabbed menus. `inputText` is the immediate-controlled
  // value (so the input feels responsive); `searchQuery` is the debounced
  // value driving `searchable.renderResults`. 150ms matches the pattern the
  // emoji picker used pre-migration.
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    hostLog.info('actionMenuHost.payload', {
      open: payload !== null,
      title: payload?.title,
      sections: payload?.sections?.length ?? 0,
      buttons: payload?.buttons?.length ?? 0,
      footerButtons: payload?.footerButtons?.length ?? 0,
      hasSearchable: !!payload?.searchable,
      snapPoint: payload?.snapPoint,
    });
    if (payload) {
      selectedRef.current = false;
      activeDismissRef.current = payload.onDismiss ?? null;
      setInputValues(buildInitialValues(payload.inputs));
      setError(null);
      setIsSubmitting(false);
      setInputText('');
      setSearchQuery('');
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
    }
  }, [payload]);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setInputText(text);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setSearchQuery(text), 150);
  }, []);

  const handleSearchClear = useCallback(() => {
    setInputText('');
    setSearchQuery('');
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, []);

  const handleOpenChange = useCallback((open: boolean): void => {
    hostLog.info('actionMenuHost.openChange', {
      open,
      stayOpen: stayOpenRef.current,
      selected: selectedRef.current,
    });
    if (open) {
      stayOpenRef.current = false;
      return;
    }
    if (stayOpenRef.current) {
      stayOpenRef.current = false;
      return;
    }
    const picked = selectedRef.current;
    const onDismiss = activeDismissRef.current;
    activeDismissRef.current = null;
    dismissActionMenuPopup();
    if (!picked && onDismiss) onDismiss();
  }, []);

  const handleItemPress = useCallback((button: ActionMenuItem): void => {
    if (button.disabled || button.isFailed) return;
    selectedRef.current = true;
    if (button.keepOpen) {
      stayOpenRef.current = true;
    } else {
      dismissActionMenuPopup();
    }
    void button.onPress?.(() => dismissActionMenuPopup());
  }, []);

  const handlePrimaryPressInner = useCallback(
    async (action: ActionMenuPrimaryAction): Promise<void> => {
      if (isSubmitting) return;
      setError(null);
      setIsSubmitting(true);
      try {
        await action.onPress(inputValues, {
          setError,
          close: () => {
            selectedRef.current = true;
            dismissActionMenuPopup();
          },
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [inputValues, isSubmitting]
  );

  // `isSubmitting` is React state — a rapid double-tap on the primary
  // action button (Import-Nsec, Claim Username, etc.) lands twice into
  // `action.onPress` and dispatches duplicate side-effects (two profile
  // imports, two `storeImportedNsec` writes). The synchronous ref guard
  // closes the window before the second call enters.
  const handlePrimaryPress = useSingleFlight(handlePrimaryPressInner);

  // Defaults-merged input values — when a chained payload introduces
  // new input keys (e.g. profile-switcher → "Import Nostr" with `nsec`),
  // `inputValues` still holds the *previous* payload's keys for one
  // render before the `useEffect` above resets it. Without this merge,
  // `isDisabled({})` dereferences `v.nsec.trim()` and throws.
  const safeInputValues = payload?.inputs
    ? { ...buildInitialValues(payload.inputs), ...inputValues }
    : inputValues;

  const primaryDisabled =
    payload?.primaryAction?.isDisabled?.(safeInputValues) === true || isSubmitting;

  // `hasFooter` decides whether to render the `<BottomButtons>` slot via
  // gorhom's `footerComponent` (which lifts above the keyboard).
  // `useScrollBody` is the stricter "needs a scrollable viewport at a
  // fixed tall snapPoint" mode — a long list of items with sticky
  // footer affordances (the profile switcher pattern). Short
  // input-form menus (e.g. the chained "Import Nostr" → nsec field +
  // submit) only have `primaryAction` and should size to content via
  // gorhom's dynamic sizing; otherwise they stretch to 85% and look
  // empty.
  // `useSections` is the tabbed mode — body becomes a `SectionAnchorList`
  // with a horizontal anchor bar above the scroll viewport. It always
  // needs a fixed snap so the list has a viewport to scroll inside.
  const useSections = !!payload?.sections?.length;
  const hasFooter = !!payload?.footerButtons?.length || !!payload?.primaryAction;
  const useScrollBody = !!payload?.footerButtons?.length || useSections;

  // Measured footer height — used to pad the scroll viewport so the last
  // row clears the absolutely-positioned footer. Two Menu.Items + safe
  // area easily exceed any hardcoded value, so we measure dynamically.
  const [footerHeight, setFooterHeight] = useState(0);
  const handleFooterLayout = useCallback((e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setFooterHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);
  useEffect(() => {
    if (!hasFooter) setFooterHeight(0);
  }, [hasFooter]);

  // Decide the sheet snap point. Explicit override wins; otherwise
  // sticky-footer lists get 60% (profile switcher), sections-tabbed
  // menus get 60%, inputs-only forms get 40%, and pure pick-one-of-N
  // menus auto-fit to content.
  const snapPoint =
    payload?.snapPoint ??
    (useSections ? '60%' : payload?.footerButtons?.length ? '60%' : hasFooter ? '40%' : undefined);

  const renderActionButton = (button: ActionMenuItem, key: React.Key): React.ReactNode => {
    const isDisabled = button.disabled === true || button.isFailed === true;
    const isDanger = button.variant === 'dangerous' || button.isFailed === true;
    const descriptionText = button.isFailed
      ? (button.reason ?? 'Failed')
      : isDisabled
        ? button.reason
        : button.description;
    const item = (
      <Menu.Item
        testID={button.testID}
        isDisabled={isDisabled}
        variant={isDanger ? 'danger' : 'default'}
        onPress={() => handleItemPress(button)}>
        <HStack align="center" gap={10} style={{ flex: 1 }}>
          {button.iconNode ?? (button.icon ? <Icon name={button.icon} size={20} /> : null)}
          <View style={{ flex: 1 }}>
            <Menu.ItemTitle>{button.text}</Menu.ItemTitle>
            {descriptionText ? (
              <Menu.ItemDescription>{descriptionText}</Menu.ItemDescription>
            ) : null}
          </View>
          {button.suffix ? <View>{button.suffix}</View> : null}
        </HStack>
      </Menu.Item>
    );
    return (
      <React.Fragment key={key}>
        {button.separator ? <View className="bg-foreground/10 mx-3 my-1 h-px" /> : null}
        {/* heroui's `variant="danger"` only tints the title/description text; a
            failed payment row needs the whole row red so it reads "tried,
            broke" at a glance instead of competing visually with neighbouring
            "Recommended" items. The description prefix ("Failed: ...") stays
            for screen readers — colour alone is not an accessibility signal. */}
        {button.isFailed ? <View className="bg-danger/10 mx-1 rounded-2xl">{item}</View> : item}
      </React.Fragment>
    );
  };

  const labelNode = payload?.title ? (
    <Menu.Label className="text-foreground -mt-2 mb-2 ml-3 text-lg font-bold">
      {payload.title}
    </Menu.Label>
  ) : null;

  const headerNode = payload?.header ? <View className="mb-2">{payload.header}</View> : null;

  const buttonsNode = payload?.buttons?.length
    ? payload.buttons.map((b, i) => renderActionButton(b, `b-${i}`))
    : null;

  const inputsNode =
    payload?.inputs && payload.inputs.length > 0 ? (
      <View className="px-3 pb-3 pt-1">
        <VStack spacing={16}>
          {payload.inputs.map((input) => (
            <MenuInputField
              key={input.id}
              input={input}
              value={inputValues[input.id] ?? ''}
              isInvalid={!!error}
              onChangeText={(next) => setInputValues((prev) => ({ ...prev, [input.id]: next }))}
            />
          ))}
          {error ? <Text className="text-danger text-sm">{error}</Text> : null}
        </VStack>
      </View>
    ) : null;

  const footerButtonsNode = payload?.footerButtons?.length
    ? payload.footerButtons.map((b, i) => renderActionButton(b, `fb-${i}`))
    : null;

  const primaryActionNode = payload?.primaryAction ? (
    <>
      <View className="bg-foreground/10 mx-3 my-1 h-px" />
      <Menu.Item
        testID={payload.primaryAction.testID}
        isDisabled={primaryDisabled}
        onPress={() => {
          void handlePrimaryPress(payload.primaryAction!);
        }}>
        <HStack align="center" gap={10} style={{ flex: 1 }}>
          {payload.primaryAction.icon ? <Icon name={payload.primaryAction.icon} size={20} /> : null}
          <View style={{ flex: 1 }}>
            <Menu.ItemTitle>
              {isSubmitting
                ? (payload.primaryAction.loadingText ?? payload.primaryAction.text)
                : payload.primaryAction.text}
            </Menu.ItemTitle>
          </View>
        </HStack>
      </Menu.Item>
    </>
  ) : null;

  // Map ActionMenuSection[] → AnchorSection<ActionMenuItem>[] for
  // SectionAnchorList. Two shapes:
  //   - Sections with `buttons` use the standard data + renderItem
  //     path so each profile row virtualizes individually (FlashList
  //     mounts only the rows in the draw window). Items render as
  //     `Menu.Item`s; the section gets no header.
  //   - Sections with `renderBody` (custom non-button content, e.g.
  //     emoji grids when this lane is used for them) render through
  //     `renderHeader` with empty `data` — same as before.
  const sectionsForList = useMemo<AnchorSection<ActionMenuItem>[]>(() => {
    const list = payload?.sections;
    if (!list?.length) return [];
    return list.map((section: ActionMenuSection) => {
      if (section.renderBody) {
        return {
          id: section.id,
          anchor: section.anchor,
          data: [] as ActionMenuItem[],
          renderHeader: () => section.renderBody!(),
        };
      }
      return {
        id: section.id,
        anchor: section.anchor,
        data: section.buttons ?? [],
      };
    });
  }, [payload?.sections]);

  const searchInputNode = payload?.searchable ? (
    <MenuSearchField
      placeholder={payload.searchable.placeholder}
      value={inputText}
      onChangeText={handleSearchChange}
      onClear={handleSearchClear}
    />
  ) : null;

  const isSearching = useSections && !!payload?.searchable && searchQuery.length > 0;
  const searchOverrideContent = isSearching
    ? (payload?.searchable?.renderResults?.(searchQuery) ?? null)
    : null;

  // Footer renderer for gorhom's `footerComponent` slot — it tracks the
  // sheet's animated bottom edge AND lifts above the keyboard when a
  // `BottomSheetTextInput` (via `MenuInputField`) gains focus. We can't
  // get that for free with a plain absolute child of `Menu.Content`,
  // which is why the chained "Import Nostr" form's submit button was
  // unreachable behind the keyboard until this was wired back up.
  //
  // Inside, we still render `<BottomButtons>` so the gradient/blur
  // recipe is identical to Receive — but with `position: 'relative'`
  // overridden so it lays out in the footer slot's flow. Otherwise
  // BottomSheetFooter's intrinsic height collapses to zero (the only
  // child is absolute) and nothing renders.
  const renderFooter = (props: React.ComponentProps<typeof BottomSheetFooter>) => (
    <BottomSheetFooter {...props}>
      <BottomButtons
        gradientColor={String(overlay)}
        style={{
          position: 'relative',
          bottom: undefined,
          left: undefined,
          right: undefined,
          width: undefined,
          // Match the scroll list's `paddingHorizontal: 12` so the
          // footer Menu.Items left-align with the rows above (and
          // with the `Menu.Label` title's `ml-3`).
          paddingHorizontal: 12,
        }}
        onLayout={handleFooterLayout}>
        {footerButtonsNode}
        {primaryActionNode}
      </BottomButtons>
    </BottomSheetFooter>
  );

  // gorhom (v5.2.14) computes the CLOSED sheet position from the measured
  // window height. On Android edge-to-edge the window is shorter than the
  // physical screen by the navigation-bar inset, so the closed sheet stops a
  // sliver above the true bottom and peeks on first load (gorhom #2680). Pin
  // containerHeight to the full screen height on Android so the closed position
  // translates fully off-screen. iOS renders in a FullWindowOverlay and is
  // unaffected.
  const androidContainerHeight =
    // eslint-disable-next-line no-restricted-syntax -- need the physical SCREEN height (not the window height useWindowDimensions exposes) to clear the edge-to-edge nav bar; the app is portrait-locked so this snapshot is stable.
    Platform.OS === 'android' ? Dimensions.get('screen').height : undefined;

  return (
    <Menu presentation="bottom-sheet" isOpen={isOpen} onOpenChange={handleOpenChange}>
      {/*
       * Bottom-sheet presentation ignores Trigger position, but heroui still
       * requires a Trigger in the tree. A zero-size, offscreen Pressable
       * satisfies the API without visually affecting anything.
       */}
      <Menu.Trigger style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}>
        <View style={{ width: 1, height: 1 }} />
      </Menu.Trigger>
      {/*
       * disableFullWindowOverlay: heroui Menu in bottom-sheet presentation
       * silently fails to mount inside FullWindowOverlay (verified by
       * tracing — host receives `isOpen=true` but gorhom never snaps the
       * sheet open). So we keep FullWindowOverlay disabled here and let
       * gorhom keyboard avoidance work for the inputs in chained menus
       * (e.g. Import Nostr nsec form). Surfaces that need above-modal
       * stacking go through `PopupHost`'s standalone `<BottomSheet>`,
       * which uses FWO and works fine — see `actionSheetTypes.ts`.
       */}
      <Menu.Portal disableFullWindowOverlay>
        <MenuScrim />
        <Menu.Content
          presentation="bottom-sheet"
          // Full screen height on Android so the closed sheet clears the
          // edge-to-edge nav bar instead of peeking (see androidContainerHeight).
          containerHeight={androidContainerHeight}
          // `interactive` lifts the sheet by the keyboard height — works with
          // dynamic sizing because position becomes (highestDetent − keyboardHeight),
          // which is strictly higher than the natural content-fit position.
          // `extend` would snap to highestDetentPosition, which equals the
          // current position under enableDynamicSizing → no-op.
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          android_keyboardInputMode="adjustResize"
          // Two sheet sizes:
          //   - hasFooter (list + sticky footer, OR input form +
          //     footer): fixed 50% snap. Long lists scroll inside
          //     the 50%; short input forms get a stable surface that
          //     doesn't stretch to fill the screen.
          //   - no footer at all: dynamic sizing (the legacy short
          //     action-picker menu auto-fits to content).
          enableDynamicSizing={!useScrollBody && !hasFooter}
          snapPoints={snapPoint ? [snapPoint] : undefined}
          // `px-0` cancels heroui's default `px-3` on the wrapper so the
          // absolute `<BottomButtons>` below can span edge-to-edge —
          // otherwise it sits 12px inset on each side, leaving a gap on
          // both sides of the gradient/blur fade. The scrollable list
          // content gets its horizontal inset back via the
          // `paddingHorizontal` on `BottomSheetScrollView`'s
          // `contentContainerStyle` below, so rows still align as before.
          //
          // `pt-2` shrinks the heroui base `py-5` (20px) down to 8px so
          // the title sits closer to the handle indicator instead of
          // floating with a noticeable empty band above it.
          //
          // `pb-0` removes heroui's `pb-safe-offset-3` (safe-area + 12px)
          // from the wrapper. The wrapper's bottom padding is irrelevant
          // for our absolute `<BottomButtons>` — but it pads the
          // *scroll viewport* inwards from the sheet bottom, which makes
          // the BlurView's bottom edge visible as a band beneath the
          // buttons. Zeroing it lets the `<BottomButtons>` floor extend
          // all the way to the sheet's true bottom edge so the gradient
          // tapers seamlessly into the sheet bg.
          // useScrollBody: `pt-0` lets the scroll viewport start flush
          // against the handle — the empty band between the handle and
          // the first list row was the wrapper's top padding. Inside
          // the scroll we re-apply 8px so the `Menu.Label`'s `-mt-2`
          // doesn't clip above the viewport.
          contentContainerClassName={useScrollBody ? 'h-full px-0 pt-0 pb-0' : 'pt-2 pb-0'}
          // Patched flag (see patches/heroui-native+1.0.2.patch): swap
          // heroui's `BottomSheetView` wrapper for a plain RN `View` so
          // the nested `BottomSheetScrollView` below stays registered
          // as the active scrollable. Without this, heroui's wrapper
          // overrides the scrollable type to `VIEW` on mount and pan
          // gestures dismiss the sheet instead of scrolling the list.
          // Only needed when there *is* a nested scroll container.
          contentContainerProps={useScrollBody ? ({ useDirectView: true } as never) : undefined}
          // gorhom's `BottomSheetFooter` slot — pinned absolute at the
          // sheet's animated bottom edge AND auto-tracks the keyboard
          // when a `BottomSheetTextInput` (via `MenuInputField`) gains
          // focus. Without it, the chained "Import Nostr" form's
          // submit button stays behind the keyboard.
          footerComponent={hasFooter ? renderFooter : undefined}>
          {useSections ? (
            // Tabbed sections — `SectionAnchorList` owns the chrome
            // (title + optional search input + horizontal anchor bar)
            // and the scroll viewport. Rows fade behind the chrome via
            // its built-in `ScrollEdgeFade` backdrop. `topFadeColor`
            // tapers to `overlay` so the fade matches the Menu.Content
            // background. `contentBottomInset` clears the gorhom
            // `BottomSheetFooter` slot so the last row isn't hidden
            // beneath sticky footer buttons.
            <SectionAnchorList<ActionMenuItem>
              sections={sectionsForList}
              // Each section's `data` is its `ActionMenuItem[]` (see
              // `sectionsForList`); we render one Menu.Item per button.
              // FlashList virtualizes the row stream so even a long
              // profile list (or future >100-item picker) only mounts
              // the rows in the draw window.
              renderItem={(button, sectionId) =>
                renderActionButton(button, `${sectionId}-${button.testID ?? button.text}`)
              }
              keyExtractor={(button, sectionId) => `${sectionId}-${button.testID ?? button.text}`}
              // The 12px horizontal inset that previously wrapped each
              // section now lives on the list contentContainer so
              // every row aligns with `Menu.Label`'s `ml-3` (24px from
              // the menu's left edge).
              listContentContainerStyle={{ paddingHorizontal: 12 }}
              ScrollComponent={BottomSheetScrollView as never}
              topFadeColor={String(overlay)}
              contentBottomInset={hasFooter ? (footerHeight > 0 ? footerHeight + 16 : 120) : 24}
              // Tab pills align with the title text: wrapper `paddingHorizontal: 12`
              // + `Menu.Label`'s `ml-3` (12px) puts the title at 24px from the
              // menu's left edge. The anchor bar's inner ScrollView uses
              // `marginHorizontal: -18` + `contentPaddingHorizontal: 18` to allow
              // overscroll past the visible bounds — those cancel out, so the
              // first pill renders at this `paddingHorizontal` value (24px).
              anchorBarStyle={{ paddingHorizontal: 24 }}
              aboveAnchors={
                <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
                  {labelNode}
                  {headerNode}
                  {searchInputNode}
                </View>
              }
              overrideContent={searchOverrideContent}
            />
          ) : useScrollBody ? (
            <>
              {/* Sticky title — rendered *outside* the scroll viewport
                  so it doesn't get clipped by the scroll's top edge as
                  the user scrolls down. The handle has no background,
                  so the title sits flush against it.
                  `paddingHorizontal: 12` matches the scroll content
                  padding so the title's `ml-3` aligns with the rows
                  below; `paddingTop: 8` mirrors the original wrapper
                  `pt-2`. */}
              <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
                {labelNode}
                {headerNode}
              </View>
              <BottomSheetScrollView
                // `flex: 1` is required for scrolling inside heroui
                // Menu.Content. Heroui wraps children in a
                // `BottomSheetView` (a plain RN View). With
                // `enableDynamicSizing={false}` + a fixed snapPoint, the
                // ScrollView has no implicit flex — its viewport
                // collapses to content height, so there's nothing to
                // scroll. Forcing `flex: 1` makes it fill the snapped
                // sheet body, restoring scroll. (gorhom's docs imply
                // BottomSheetScrollView is intended to be the BottomSheet's
                // direct child where it inherits sheet height; under
                // heroui-native it isn't, so we pass flex explicitly.)
                style={{ flex: 1 }}
                contentContainerStyle={{
                  // Re-introduce the horizontal inset that the wrapper's
                  // `px-3` was providing (we cancel it via the
                  // `contentContainerClassName="px-0"` above so the
                  // `<BottomButtons>` footer can go edge-to-edge).
                  paddingHorizontal: 12,
                  // Pad past the measured footer so the last row clears
                  // the absolute footer + its safe-area inset. Falls
                  // back to a generous default until the layout pass
                  // reports the real height.
                  paddingBottom: footerHeight > 0 ? footerHeight + 16 : 200,
                }}
                showsVerticalScrollIndicator={false}>
                {buttonsNode}
                {inputsNode}
              </BottomSheetScrollView>
            </>
          ) : (
            // With dynamic sizing, gorhom measures this view's
            // `onLayout` height for the sheet height — but the
            // `BottomSheetFooter` is a *separate* absolute container,
            // so its height isn't counted. Without explicit
            // `paddingBottom` here the footer overlaps the input. Pad
            // by the measured footer height (with a generous fallback
            // before the first measurement lands). When there is no
            // footer at all (the canonical short menu — title + 2-3
            // buttons), pad by the safe-area-bottom + 12 so the last
            // row clears the home indicator. The wrapper-level `pb-0`
            // we apply further up zeroed heroui's default
            // `pb-safe-offset-3`; this re-introduces it for the only
            // path that doesn't have an absolute footer of its own.
            <View
              style={{
                paddingBottom: hasFooter
                  ? footerHeight > 0
                    ? footerHeight + 16
                    : 120
                  : insets.bottom + 12,
              }}>
              {labelNode}
              {headerNode}
              {buttonsNode}
              {inputsNode}
              {/* primaryActionNode renders in the footer slot when hasFooter
                  (gorhom `BottomSheetFooter` lifts it above the keyboard);
                  inline only when there's no footer at all. */}
              {!hasFooter ? primaryActionNode : null}
            </View>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}
