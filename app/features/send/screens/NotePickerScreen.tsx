/**
 * The note picker: the ecash held at one mint, by denomination, to choose
 * from by hand.
 *
 * It answers a question the keypad cannot: "what can I hand over exactly?"
 * Whatever is picked here is an amount the wallet already holds, so it can be
 * sent with no mint and no network. The total goes back to the keypad; the
 * picker sends nothing itself.
 */

import { useEffect, useState } from 'react';
import { composeSatoshis } from 'wallet';

import Icon from '@/assets/icons';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';
import { formatAmount } from '@/shared/lib/currency';
import { useNotePickerStore } from '@/shared/stores/runtime/notePickerStore';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { EcashNote } from '@/shared/ui/composed/EcashNote';
import { Screen } from '@/shared/ui/composed/Screen';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

import {
  groupNotes,
  pickCount,
  pickFor,
  pickTotal,
  stepPick,
  stepTotal,
  type NoteDenomination,
  type NotePick,
} from '../lib/notePicking';

const EMPTY_NOTES: readonly number[] = [];
/** The pinned total's height, declared so the list reserves exactly that. */
const TOTAL_HEIGHT = 104;

interface NoteRowProps {
  denomination: NoteDenomination;
  unit: string;
  picked: number;
  backdrop: string;
  onStep: (delta: 1 | -1) => void;
}

function NoteRow({ denomination, unit, picked, backdrop, onStep }: NoteRowProps) {
  const foreground = useThemeColor('foreground');
  const quiet = withAlpha(foreground, 0.55);
  // A step that cannot be taken stays in place, faint, so the row never shifts.
  const spent = withAlpha(foreground, 0.25);
  const full = picked >= denomination.held;
  const control = { backgroundColor: withAlpha(foreground, 0.1) };
  const label = formatAmount({ amount: denomination.value, unit }, { currencyDisplay: 'name' });

  return (
    <View
      testID={`note-row-${denomination.value}`}
      className="min-h-[60px] flex-row items-center gap-3">
      {/* The note itself is the big target: tap it to take one more. */}
      <Pressable
        testID={`note-add-${denomination.value}`}
        accessibilityRole="button"
        accessibilityLabel={`Add a ${label} note`}
        accessibilityState={{ disabled: full }}
        disabled={full}
        onPress={() => onStep(1)}
        className="min-w-[112px]">
        <EcashNote
          backdrop={backdrop}
          height={40}
          selected={picked > 0}
          faint={full && picked === 0}>
          <AmountFormatter
            amount={denomination.value}
            unit={unit}
            size={15}
            weight="heavy"
            color={picked > 0 ? backdrop : foreground}
          />
        </EcashNote>
      </Pressable>

      <View className="flex-1">
        <Text family="mono" size={13} color={quiet}>
          {picked} of {denomination.held}
        </Text>
      </View>

      <Pressable
        testID={`note-remove-${denomination.value}`}
        accessibilityRole="button"
        accessibilityLabel={`Remove a ${label} note`}
        accessibilityState={{ disabled: picked === 0 }}
        disabled={picked === 0}
        hitSlop={6}
        onPress={() => onStep(-1)}
        className="h-10 w-10 items-center justify-center rounded-full"
        style={control}>
        <Icon name="mdi:minus" size={18} color={picked === 0 ? spent : foreground} />
      </Pressable>
      <Pressable
        testID={`note-add-button-${denomination.value}`}
        accessibilityRole="button"
        accessibilityLabel={`Add a ${label} note`}
        accessibilityState={{ disabled: full }}
        disabled={full}
        hitSlop={6}
        onPress={() => onStep(1)}
        className="h-10 w-10 items-center justify-center rounded-full"
        style={control}>
        <Icon name="mdi:plus" size={18} color={full ? spent : foreground} />
      </Pressable>
    </View>
  );
}

export function NotePickerScreen() {
  const request = useNotePickerStore((state) => state.request);
  const clear = useNotePickerStore((state) => state.clear);
  const [foreground, surface, success] = useThemeColor([
    'foreground',
    'surface',
    'success',
  ] as const);
  const quiet = withAlpha(foreground, 0.55);

  const notes = request?.notes ?? EMPTY_NOTES;
  const unit = request?.unit ?? 'sat';
  const denominations = groupNotes(notes);
  // Seeded once, from the amount that was on the keypad: the picker is then
  // the sender's, and a balance update underneath must not re-pick for them.
  const [pick, setPick] = useState<NotePick>(() => pickFor(denominations, request?.amount ?? 0));

  // Leaving by any road (Use, a pull, the back button) ends the hand-off.
  useEffect(() => clear, [clear]);

  const total = pickTotal(pick);
  const count = pickCount(pick);
  const rule = { backgroundColor: withAlpha(foreground, 0.1) };
  const control = { backgroundColor: withAlpha(foreground, 0.1) };
  const spent = withAlpha(foreground, 0.25);
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerSpacer = { height: headerHeight };
  const totalBox = { height: TOTAL_HEIGHT };

  // The next amount these notes can make, either way. Worked out for both
  // directions on every pick so a step that leads nowhere is drawn faint.
  const nearest = (target: number) => {
    const found = composeSatoshis([...notes], target);
    return { exactMatch: found.exactMatch, lower: found.nearestLower, upper: found.nearestUpper };
  };
  const down = stepTotal(denominations, total, -1, nearest);
  const up = stepTotal(denominations, total, 1, nearest);

  const use = () => {
    request?.onUse(total);
    router.back();
  };

  return (
    <Screen
      name="NotePickerScreen"
      // The total stays put while the notes scroll under it, like the
      // currency tabs on the mint pages.
      headerAppearance="opaque"
      stickyContent={
        <View className="flex-row items-center justify-between gap-3 px-4" style={totalBox}>
          <Pressable
            testID="note-picker-step-down"
            accessibilityRole="button"
            accessibilityLabel="Next smaller amount"
            accessibilityState={{ disabled: !down }}
            disabled={!down}
            hitSlop={8}
            onPress={() => down && setPick(down.pick)}
            className="h-11 w-11 items-center justify-center rounded-full"
            style={control}>
            <Icon name="mdi:minus" size={20} color={down ? foreground : spent} />
          </Pressable>
          <View className="flex-1 items-center gap-1">
            <AmountFormatter
              amount={total}
              unit={unit}
              size={36}
              weight="heavy"
              color={count > 0 ? foreground : withAlpha(foreground, 0.4)}
              centered
            />
            <View className="flex-row items-center gap-1.5">
              <Icon name="mdi:airplane" size={13} color={count > 0 ? success : quiet} />
              <Text
                testID="note-picker-count"
                family="mono"
                size={12}
                color={count > 0 ? success : quiet}>
                {count} of {notes.length} notes
              </Text>
            </View>
          </View>
          <Pressable
            testID="note-picker-step-up"
            accessibilityRole="button"
            accessibilityLabel="Next larger amount"
            accessibilityState={{ disabled: !up }}
            disabled={!up}
            hitSlop={8}
            onPress={() => up && setPick(up.pick)}
            className="h-11 w-11 items-center justify-center rounded-full"
            style={control}>
            <Icon name="mdi:plus" size={20} color={up ? foreground : spent} />
          </Pressable>
        </View>
      }
      stickyContentHeight={TOTAL_HEIGHT}
      scroll="custom"
      onHeaderHeightChange={setHeaderHeight}
      footer={
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                text: 'Clear',
                variant: 'secondary',
                testID: 'note-picker-clear',
                onPress: () => setPick({}),
                condition: count > 0,
              },
              {
                text: 'Use amount',
                variant: 'primary',
                testID: 'note-picker-use',
                disabled: count === 0,
                onPress: use,
              },
            ]}
          />
        </BottomButtons>
      }>
      <ScreenScrollView testID="note-picker" className="flex-1" contentContainerClassName="px-4">
        <View style={headerSpacer} />
        {denominations.length === 0 ? (
          <Text size={14} color={quiet} className="py-8 text-center">
            No notes at this mint.
          </Text>
        ) : (
          denominations.map((denomination, index) => (
            <View key={denomination.value}>
              {index > 0 ? <View className="h-px" style={rule} /> : null}
              <NoteRow
                denomination={denomination}
                unit={unit}
                picked={pick[denomination.value] ?? 0}
                backdrop={surface}
                onStep={(delta) => setPick((current) => stepPick(current, denomination, delta))}
              />
            </View>
          ))
        )}
      </ScreenScrollView>
    </Screen>
  );
}
