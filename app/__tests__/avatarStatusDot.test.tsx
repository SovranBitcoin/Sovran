import { render } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import Icon from '@/assets/icons';
import { Avatar, AvatarStatusDot } from '@/shared/ui/primitives/Avatar';

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: string) => `theme-${token}`,
}));

jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: () => 'transparent',
}));

jest.mock('@/shared/lib/logger', () => ({
  log: { warn: jest.fn() },
  storeLog: { warn: jest.fn() },
  redactError: (error: unknown) => error,
}));

jest.mock('@/shared/lib/imageCache', () => ({ prefetchImage: jest.fn() }));
jest.mock('@/shared/lib/contentShiftLog', () => ({
  useVisualLayoutLogger: () => ({}),
}));
jest.mock('@/shared/ui/primitives/ClaySilhouetteAvatar', () => ({
  ClaySilhouetteAvatar: () => null,
}));

describe('AvatarStatusDot', () => {
  it.each([
    ['OK', 'bg-success', 'fluent:checkmark-16-filled', 'theme-success-foreground', 'OK'],
    ['ERROR', 'bg-danger', 'mdi:alert-circle', 'theme-danger-foreground', 'Error'],
    ['OFFLINE', 'bg-muted', 'feather:wifi-off', 'theme-background', 'Offline'],
  ])(
    'renders %s with a solid disc, page outline, and status icon',
    (status, fill, icon, iconColor, label) => {
      const view = render(<AvatarStatusDot status={status} size={70 * 0.33} />);
      const dot = view.UNSAFE_getByProps({ testID: 'avatar-status-dot' });

      expect(dot.props.className.split(' ')).toEqual(
        expect.arrayContaining([
          fill,
          'rounded-full',
          'border-4',
          'border-surface',
          'items-center',
          'justify-center',
        ])
      );
      expect(dot.props.style).toEqual({ width: 35.1, height: 35.1 });
      expect(dot.props).toMatchObject({ accessibilityRole: 'image', accessibilityLabel: label });
      expect(view.UNSAFE_getByType(Icon).props).toMatchObject({
        name: icon,
        size: 23.1,
        color: iconColor,
      });
    }
  );

  it.each([undefined, 'UNKNOWN', 'toString'])('omits unsupported status %s', (status) => {
    const view = render(<AvatarStatusDot status={status} size={16} />);
    expect(view.UNSAFE_queryByProps({ testID: 'avatar-status-dot' })).toBeNull();
  });

  it.each(['loading', 'fallback', 'image'] as const)(
    'uses the shared dot without clipping its frame in the %s state',
    (state) => {
      const view = render(
        <Avatar
          state={state}
          picture="https://example.invalid/avatar.png"
          status="ERROR"
          size={48}
        />
      );
      expect(view.UNSAFE_getByType(AvatarStatusDot).props).toMatchObject({
        status: 'ERROR',
        size: 48 * 0.33,
      });
      expect(view.UNSAFE_getByProps({ testID: 'avatar-status-dot' })).toBeTruthy();
      const frame = view.UNSAFE_getByType(Avatar).findByType(View);
      expect(StyleSheet.flatten(frame.props.style).overflow).toBe('visible');
    }
  );

  it('preserves the separate VERIFIED marker', () => {
    const view = render(<Avatar state="fallback" status="VERIFIED" />);
    expect(view.UNSAFE_queryByProps({ testID: 'avatar-status-dot' })).toBeNull();
    expect(view.UNSAFE_getByType(Icon).props.name).toBe('material-symbols:verified-rounded');
  });
});
