import { forwardRef, useState, type ComponentProps } from 'react';
import { Platform, Text as RNText, TextInput, View as RNView } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { cn } from '@/shared/lib/classNames';
import { injectParts } from '@/shared/lib/injectParts';
import { Pressable } from './Pressable';
import { Switch } from './Switch';
import { SELECTION_HAPTICS } from './Haptics';

/**
 * Form parts: `TextField` stacks a `Label`, an `Input` and a `Description`
 * (and disables them together); `ControlField` is a pressable row ending in
 * a switch; `RadioGroup` is a single choice among labelled rows.
 */

type ViewProps = ComponentProps<typeof RNView> & { className?: string };
type TextProps = ComponentProps<typeof RNText> & { className?: string };

/** What a `TextField` hands its label, input and description. */
type InFieldProps = { inField?: boolean; fieldDisabled?: boolean };

export function TextField({
  isDisabled = false,
  className,
  children,
  ...rest
}: ViewProps & { isDisabled?: boolean }) {
  return (
    <RNView className={cn('gap-1.5', className)} {...rest}>
      {injectParts(children, [LabelRoot, Input, Description], {
        inField: true,
        fieldDisabled: isDisabled,
      })}
    </RNView>
  );
}

export const Input = forwardRef<
  TextInput,
  ComponentProps<typeof TextInput> &
    InFieldProps & {
      className?: string;
      variant?: 'primary' | 'secondary';
      isInvalid?: boolean;
    }
>(function Input(
  {
    variant = 'primary',
    isInvalid = false,
    inField: _inField,
    fieldDisabled: isDisabled = false,
    className,
    style,
    onFocus,
    onBlur,
    editable,
    ...rest
  },
  ref
) {
  const [focused, setFocused] = useState(false);
  const [accent, danger, placeholder] = useThemeColor([
    'accent',
    'danger',
    'field-placeholder',
  ] as const);
  const ring = isInvalid ? danger : focused ? accent : 'transparent';
  return (
    <TextInput
      ref={ref}
      editable={editable ?? !isDisabled}
      placeholderTextColor={placeholder}
      selectionColor={isInvalid ? danger : accent}
      className={cn(
        'text-foreground border-field-border border-field-width rounded-field min-h-12 px-3 font-normal',
        variant === 'primary' ? 'bg-field' : 'bg-default',
        variant === 'primary' && (Platform.OS === 'ios' ? 'shadow-field' : 'shadow-sm'),
        isDisabled && 'opacity-disabled',
        className
      )}
      style={[
        { borderCurve: 'continuous' },
        Platform.OS === 'ios'
          ? { outlineWidth: 2, outlineStyle: 'solid', outlineColor: ring }
          : { borderWidth: 1.5, borderColor: ring },
        style,
      ]}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      {...rest}
    />
  );
});

function LabelText({ className, ...rest }: TextProps) {
  return (
    <RNText
      className={cn('text-foreground text-left text-base font-medium', className)}
      {...rest}
    />
  );
}

/** A field's label: a string child renders as `Label.Text`. */
function LabelRoot({
  children,
  className,
  inField = false,
  fieldDisabled: isDisabled = false,
  ...rest
}: ViewProps & InFieldProps) {
  return (
    <RNView
      className={cn(inField && 'px-1.5', isDisabled && 'opacity-disabled', className)}
      pointerEvents={isDisabled ? 'none' : undefined}
      {...rest}>
      {typeof children === 'string' ? <LabelText>{children}</LabelText> : children}
    </RNView>
  );
}

export const Label = Object.assign(LabelRoot, { Text: LabelText });

export function Description({
  className,
  inField = false,
  fieldDisabled: isDisabled = false,
  ...rest
}: TextProps & InFieldProps) {
  return (
    <RNText
      className={cn(
        'text-muted text-left text-sm font-normal',
        inField && 'px-1.5',
        isDisabled && 'opacity-disabled',
        className
      )}
      {...rest}
    />
  );
}

/** A row that toggles `isSelected` anywhere it is pressed. */
function ControlFieldRoot({
  isSelected,
  onSelectedChange,
  className,
  children,
  ...rest
}: Omit<ComponentProps<typeof Pressable>, 'children'> & {
  className?: string;
  isSelected: boolean;
  onSelectedChange?: (next: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <Pressable
      activeOpacity={1}
      className={cn('flex-row items-center gap-3', className)}
      haptics={SELECTION_HAPTICS}
      onPress={() => onSelectedChange?.(!isSelected)}
      {...rest}>
      {injectParts(children, [ControlFieldIndicator], { isSelected, onSelectedChange })}
    </Pressable>
  );
}

function ControlFieldIndicator({
  isSelected = false,
  onSelectedChange,
}: {
  isSelected?: boolean;
  onSelectedChange?: (next: boolean) => void;
}) {
  return (
    // The row owns the press and the accessibility state; the switch is its picture.
    <RNView accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Switch isSelected={isSelected} onSelectedChange={onSelectedChange} />
    </RNView>
  );
}

export const ControlField = Object.assign(ControlFieldRoot, { Indicator: ControlFieldIndicator });

function RadioGroupRoot({
  value,
  onValueChange,
  className,
  children,
  ...rest
}: ViewProps & { value?: string; onValueChange?: (value: string) => void }) {
  return (
    <RNView accessibilityRole="radiogroup" className={cn('gap-3', className)} {...rest}>
      {injectParts(children, [RadioGroupItem], { groupValue: value, onValueChange })}
    </RNView>
  );
}

function RadioGroupItem({
  value,
  children,
  testID,
  groupValue,
  onValueChange,
}: {
  value: string;
  children: React.ReactNode;
  testID?: string;
  groupValue?: string;
  onValueChange?: (value: string) => void;
}) {
  const selected = groupValue === value;
  return (
    <Pressable
      testID={testID}
      activeOpacity={1}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className="flex-row items-center justify-between gap-3"
      haptics={SELECTION_HAPTICS}
      onPress={() => onValueChange?.(value)}>
      {typeof children === 'string' ? <LabelText>{children}</LabelText> : children}
      <RNView
        className={cn(
          'border-field-border border-field-width h-6 w-6 items-center justify-center overflow-hidden rounded-full',
          selected ? 'bg-accent' : 'bg-field shadow-field'
        )}>
        <RNView
          className={cn(
            'bg-accent-foreground shadow-field h-2.5 w-2.5 rounded-full',
            selected ? 'opacity-100' : 'opacity-0'
          )}
        />
      </RNView>
    </Pressable>
  );
}

export const RadioGroup = Object.assign(RadioGroupRoot, { Item: RadioGroupItem });
