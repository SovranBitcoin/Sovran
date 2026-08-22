import type { StyleProp, ViewStyle } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';

import { withAlpha } from '@/shared/lib/color';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';

/**
 * Search input for a bottom-sheet popup, with a clear button that appears once
 * the field has content.
 *
 * Uses `BottomSheetTextInput` rather than a plain `TextInput` so gorhom's
 * keyboard avoidance lifts the sheet on focus. The wrapper is the clear
 * button's containing block, so its absolute `right` is measured from the
 * input's edge — callers that need outer padding must add their own wrapper
 * around this one rather than pushing it in via `style`.
 */
export function SheetSearchField({
  placeholder,
  value,
  onChangeText,
  onClear,
  style,
  testID,
  clearTestID,
}: {
  placeholder?: string;
  value: string;
  onChangeText: (next: string) => void;
  onClear: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  clearTestID?: string;
}) {
  const [foreground, surfaceSecondary, placeholderColor] = useThemeColor([
    'foreground',
    'surface-secondary',
    'field-placeholder',
  ] as const);
  return (
    <View style={[{ justifyContent: 'center' }, style]}>
      <BottomSheetTextInput
        testID={testID}
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
          testID={clearTestID}
          onPress={onClear}
          hitSlop={8}
          style={{ position: 'absolute', right: 10, padding: 4 }}>
          <Icon name="mdi:close-circle" size={18} color={withAlpha(foreground, 0.33)} />
        </Pressable>
      ) : null}
    </View>
  );
}
