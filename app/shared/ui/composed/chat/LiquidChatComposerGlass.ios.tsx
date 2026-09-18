/**
 * @fileoverview iOS glass tier of `LiquidChatComposer` (liquid-glass devices).
 *
 * Pure SwiftUI: the input bubble is a real `SwiftUI.TextField` rendered inside
 * the same `Host` as the [+] / [→] buttons, all wrapped in `Namespace` +
 * `GlassEffectContainer` so the morph between empty and "has text" animates
 * via matched-geometry. Lives in an `.ios.tsx` file so `@expo/ui/swift-ui`
 * never reaches the Android bundle; `LiquidChatComposer` picks this tier from
 * `useCapabilities().liquidGlass`.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Host,
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
  TextField as SwiftUITextField,
  type TextFieldRef,
  Namespace,
  GlassEffectContainer,
} from '@expo/ui/swift-ui';
import {
  Animation,
  accessibilityLabel as swiftAccessibilityLabel,
  animation,
  autocorrectionDisabled as swiftAutocorrectionDisabled,
  buttonStyle,
  contentShape,
  disabled as disabledModifier,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  glassEffectId,
  onSubmit as onSubmitModifier,
  onTapGesture,
  opacity as swiftOpacity,
  padding,
  scaleEffect,
  shapes,
  submitLabel,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers';
import { useLatestRef } from '@/shared/hooks/useLatestRef';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { View } from '@/shared/ui/primitives/View/View';

import { plusA11yLabel, type LiquidChatComposerGlassProps } from './LiquidChatComposerGlass.types';
import { BUTTON_SIZE, GAP, ICON_SIZE } from './liquidChatComposerMetrics';

/** `Host` is a native SwiftUI container and takes no Tailwind class. */
const HOST_STYLE = { width: '100%', height: BUTTON_SIZE } as const;

/**
 * Spring tuned to match SwiftUI's `.bouncy(duration: 0.4, extraBounce: 0.15)`.
 * `bounce: 0.45` is the iOS-17+ name for the spring's overshoot, which is
 * what produces the "appears small and grows" feel on the trailing send
 * button. A heavily-damped spring (`dampingFraction: 0.8`, ≈ `.smooth`)
 * lands without any overshoot, which is why earlier revs felt flat.
 */
const SEND_SPRING = Animation.spring({ duration: 0.4, bounce: 0.45 });

/**
 * Imperative handle for the SwiftUI `TextField`.
 *
 * The ref lives here, not in the composer: handing a ref-closing callback to a
 * function during render — which `onTapGesture(focus)` is — reads to React
 * Compiler as a render-time ref access, and skips the whole composer. Holding
 * it in a hook costs this (unmemoizable anyway) hook and nothing else.
 */
function useTextFieldHandle() {
  const ref = useRef<TextFieldRef>(null);
  const focus = useCallback(() => {
    void ref.current?.focus();
  }, []);
  const setText = useCallback((text: string) => {
    void ref.current?.setText(text);
  }, []);
  return { ref, focus, setText };
}

export function LiquidChatComposerGlass({
  value,
  onChangeText,
  onSend,
  onPlusPress,
  onLayout,
  disabled,
  plusDisabled,
  placeholder,
  bottomPadding,
  hasText,
  canSend,
  foreground,
}: LiquidChatComposerGlassProps) {
  const bottomPaddingStyle = { paddingBottom: bottomPadding };
  // Stable namespace id for `glassEffectId(_:in:)` matched-geometry. `useId`
  // gives one per component instance; a fresh id on remount is the desired
  // behavior (no morph carry-over between mounts).
  const namespaceId = useId();

  // SwiftUI `TextField` sync. The native field is uncontrolled — SDK 56's
  // @expo/ui dropped `defaultValue`, so it's seeded via `ref.setText` on mount
  // and reports edits via `onTextChange`. We mirror its current text in a ref
  // and bump `resetKey` whenever the prop diverges from the last reported
  // value, which remounts + re-seeds the field. Internal keystrokes update the
  // ref synchronously before the `onTextChange` round-trip lands, so the prop
  // change is a no-op (`value === lastSwiftValueRef.current`) and the key
  // doesn't bump on every character.
  const lastSwiftValueRef = useRef(value);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    if (value !== lastSwiftValueRef.current) {
      lastSwiftValueRef.current = value;
      setResetKey((k) => k + 1);
    }
  }, [value]);
  const handleSwiftValueChange = useCallback(
    (text: string) => {
      lastSwiftValueRef.current = text;
      onChangeText(text);
    },
    [onChangeText]
  );

  // Imperative handle so taps on the capsule's padding edges (outside the
  // TextField's intrinsic content rect) can focus the field — see the
  // `onTapGesture(focusTextField)` on the bubble below.
  const {
    ref: textFieldRef,
    focus: focusTextField,
    setText: setTextFieldText,
  } = useTextFieldHandle();
  // SDK 56 @expo/ui dropped TextField `defaultValue`. The field is still
  // uncontrolled (manages its own internal state), so seed it imperatively on
  // (re)mount — `resetKey` bumps remount the field with the latest `value`.
  // `value` is the seed, `resetKey` the trigger: re-seeding on every keystroke
  // would fight the field's own uncontrolled state.
  const valueRef = useLatestRef(value);
  useEffect(() => {
    const seed = valueRef.current;
    if (seed) setTextFieldText(seed);
  }, [resetKey, valueRef, setTextFieldText]);

  return (
    <View onLayout={onLayout} className="px-3 pt-2" style={bottomPaddingStyle}>
      <Host
        style={HOST_STYLE}
        matchContents={false}
        // §7a: stop the SwiftUI hosting controller from applying its own
        // keyboard safe-area inset. RN keyboard-controller now drives the
        // composer position from the JS side via KeyboardStickyView; if
        // SwiftUI also avoids the keyboard the composer double-jumps.
        ignoreSafeArea="keyboard">
        <Namespace id={namespaceId}>
          {/* `spacing={0}` is the glass *merge threshold* — when the
              nearest edges of two glass shapes are closer than this, the
              system blends them into a single liquid-metaball blob. We
              want the [+] / input / [→] visually distinct in steady
              state, so spacing=0; the bounce-in / morph still animates
              because that's driven by `glassEffectId` matched-geometry,
              not by the blend threshold. */}
          <GlassEffectContainer spacing={0}>
            <SwiftUIHStack
              alignment="center"
              spacing={GAP}
              modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
              {/* Leading [+] glass button. `buttonStyle('glass')` provides
                  BOTH the visible glass material AND the built-in liquid
                  press animation — stacking an explicit `glassEffect()`
                  on top draws a doubled concentric ring on press, so we
                  don't. The shared `animation(SEND_SPRING, hasText)`
                  on every glass child re-evaluates inside one transaction
                  when the boolean flips, which is the @expo/ui equivalent
                  of `withAnimation { state.toggle() }` in SwiftUI. */}
              <SwiftUIButton
                modifiers={[
                  buttonStyle('glass'),
                  frame({ width: BUTTON_SIZE, height: BUTTON_SIZE }),
                  glassEffectId('plus', namespaceId),
                  swiftOpacity(plusDisabled ? 0.35 : 1),
                  animation(SEND_SPRING, hasText),
                  swiftAccessibilityLabel(plusA11yLabel(plusDisabled)),
                ]}
                onPress={disabled ? () => {} : onPlusPress}>
                <SwiftUIHStack
                  alignment="center"
                  modifiers={[
                    frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' }),
                  ]}>
                  <SwiftUIImage
                    systemName={'plus' as never}
                    size={ICON_SIZE}
                    color={INVARIANT_WHITE}
                  />
                </SwiftUIHStack>
              </SwiftUIButton>

              {/* Middle input — glass capsule HStack containing a real
                  SwiftUI `TextField`. The capsule itself is NOT a button:
                  `buttonStyle('glass')` adds intrinsic padding around its
                  content that won't compress when the frame width is
                  flexible, which previously blew the bubble up to ~110pt.
                  `glassEffect()` directly on the HStack gives us the same
                  material with the frame `height: BUTTON_SIZE` honored,
                  and `glass.interactive: true` opts the shape into Apple's
                  liquid press feedback — the exact same morph animation
                  `buttonStyle('glass')` runs internally — without the
                  button-style sizing semantics. Padding-edge taps focus
                  the field via `contentShape` + `onTapGesture` (without
                  `contentShape` only the visible glyph areas would be
                  hit-testable). */}
              <SwiftUIHStack
                alignment="center"
                spacing={6}
                modifiers={[
                  frame({ maxWidth: Infinity, height: BUTTON_SIZE, alignment: 'center' }),
                  glassEffect({
                    shape: 'capsule',
                    glass: { variant: 'regular', interactive: true },
                  }),
                  glassEffectId('input', namespaceId),
                  contentShape(shapes.capsule()),
                  onTapGesture(focusTextField),
                  animation(SEND_SPRING, hasText),
                ]}>
                <SwiftUITextField
                  key={resetKey}
                  ref={textFieldRef}
                  placeholder={placeholder}
                  onTextChange={handleSwiftValueChange}
                  axis="horizontal"
                  modifiers={[
                    frame({ maxWidth: Infinity, alignment: 'leading' }),
                    padding({ leading: 16, trailing: 4 }),
                    foregroundStyle(foreground),
                    font({ size: 16 }),
                    submitLabel('send'),
                    onSubmitModifier(onSend),
                    swiftAutocorrectionDisabled(false),
                    textInputAutocapitalization('sentences'),
                    disabledModifier(!!disabled),
                    // SwiftUI-hosted field: no RN testID reaches AX, so the
                    // label is the only stable handle (VoiceOver + e2e).
                    swiftAccessibilityLabel('Message composer'),
                  ]}
                />
              </SwiftUIHStack>

              {/* Trailing [→] glass button. ALWAYS rendered — toggling
                  its presence via React unmount bypasses SwiftUI's
                  animation transaction and produces a hard pop. Instead
                  collapse to width=0 + scale=0 + opacity=0 when empty
                  and let the bouncy spring drive the interpolation, so
                  the button "appears small and gets bigger" the way
                  Apple's Messages composer does. The matched-geometry
                  seam to the input capsule comes from sharing the
                  GlassEffectContainer + glassEffectId namespace. */}
              <SwiftUIButton
                modifiers={[
                  buttonStyle('glass'),
                  frame({
                    width: hasText ? BUTTON_SIZE : 0,
                    height: BUTTON_SIZE,
                  }),
                  scaleEffect(hasText ? 1 : 0),
                  swiftOpacity(hasText ? 1 : 0),
                  glassEffectId('send', namespaceId),
                  disabledModifier(!canSend),
                  animation(SEND_SPRING, hasText),
                  swiftAccessibilityLabel('Send message'),
                ]}
                onPress={canSend ? onSend : () => {}}>
                <SwiftUIHStack
                  alignment="center"
                  modifiers={[
                    frame({
                      maxWidth: Infinity,
                      maxHeight: Infinity,
                      alignment: 'center',
                    }),
                  ]}>
                  <SwiftUIImage
                    systemName={'arrow.up' as never}
                    size={ICON_SIZE}
                    color={INVARIANT_WHITE}
                  />
                </SwiftUIHStack>
              </SwiftUIButton>
            </SwiftUIHStack>
          </GlassEffectContainer>
        </Namespace>
      </Host>
    </View>
  );
}
