import { act, render } from '@testing-library/react-native';
// eslint-disable-next-line no-restricted-imports -- Locate the native press boundary the shared wrapper renders.
import { Pressable as NativePressable } from 'react-native';

import { SelectableCheck } from '@/shared/ui/primitives/SelectableCheck';

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    Array.isArray(tokens) ? tokens.map((token) => `theme-${token}`) : `theme-${String(tokens)}`,
}));

jest.mock('@/shared/lib/logger', () => ({
  log: { warn: jest.fn(), debug: jest.fn() },
  storeLog: { warn: jest.fn() },
  redactError: (error: unknown) => error,
}));

jest.mock('@/shared/ui/primitives/Haptics', () => ({
  EnhancedHaptics: { buttonHaptic: jest.fn() },
}));

describe('SelectableCheck square', () => {
  it('is display only without onChange, so the parent row owns the press', () => {
    const view = render(<SelectableCheck style="square" selected testID="row-check" />);

    expect(view.UNSAFE_queryByType(NativePressable)).toBeNull();
    expect(view.UNSAFE_queryByProps({ accessibilityRole: 'checkbox' })).toBeNull();
  });

  it('stands alone as a 44pt checkbox when onChange is given', () => {
    const onChange = jest.fn();
    const view = render(
      <SelectableCheck
        style="square"
        selected={false}
        onChange={onChange}
        accessibilityLabel="Accept terms"
        testID="terms-check"
      />
    );

    const checkbox = view.UNSAFE_getByType(NativePressable);
    expect(checkbox.props).toMatchObject({
      testID: 'terms-check',
      accessibilityRole: 'checkbox',
      accessibilityLabel: 'Accept terms',
      accessibilityState: { checked: false, disabled: false },
      // 20pt box + 12pt slop on each side.
      hitSlop: 12,
    });

    act(() => {
      checkbox.props.onPress({});
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
