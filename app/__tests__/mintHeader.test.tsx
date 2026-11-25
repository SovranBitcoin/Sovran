/**
 * Mint Info's header: the 72pt icon with the shared bottom-right presence dot,
 * the mint name, and its host when different. No extra "Operational" text line.
 */
import { render, screen } from '@testing-library/react-native';

import { MintHeader, mintHealthFromAudit } from '@/features/mint/components/MintHeader';

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: unknown) => (Array.isArray(token) ? token.map(() => 'black') : 'black'),
}));
jest.mock('@/shared/ui/composed/MintIcon', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    MintIcon: ({ size, isLoading }: { size: number; isLoading?: boolean }) =>
      createElement('View', { testID: `mint-icon:${size}:${isLoading ? 'loading' : 'ready'}` }),
  };
});
jest.mock('@/shared/ui/primitives/PresenceDot', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const labels: Record<string, string> = {
    online: 'Online',
    degraded: 'Having problems',
    offline: 'Offline',
  };
  return {
    PresenceDot: ({ presence, size }: { presence?: string | null; size: number }) =>
      presence
        ? createElement('View', {
            testID: `presence-dot:${presence}:${size}`,
            accessibilityLabel: labels[presence],
          })
        : null,
  };
});
jest.mock('@/shared/ui/primitives/Text', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    Text: ({ children }: { children: import('react').ReactNode }) =>
      createElement('Text', null, children),
  };
});
jest.mock('@/shared/ui/primitives/View/View', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    View: ({ children, ...props }: { children?: import('react').ReactNode }) =>
      createElement('View', props, children),
  };
});
jest.mock('react-native-reanimated', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: import('react').ReactNode }) =>
        createElement('View', props, children),
    },
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    useSharedValue: (value: number) => ({ get: () => value, set: () => undefined }),
    withTiming: (value: number) => value,
  };
});

describe('mintHealthFromAudit', () => {
  it('maps each auditor state, and nothing for an unaudited mint', () => {
    expect(mintHealthFromAudit('OK')).toBe('operational');
    expect(mintHealthFromAudit('ERROR')).toBe('problems');
    expect(mintHealthFromAudit('offline')).toBe('offline');
    expect(mintHealthFromAudit(undefined)).toBeUndefined();
    expect(mintHealthFromAudit('SOMETHING')).toBeUndefined();
  });
});

describe('MintHeader', () => {
  it('shows the 72pt icon with the bottom-right dot, the name and the host — no status text line', () => {
    render(
      <MintHeader
        name="Minibits"
        mintUrl="https://mint.minibits.cash/Bitcoin"
        health="operational"
      />
    );
    expect(screen.getByTestId('mint-icon:72:ready')).toBeTruthy();
    expect(screen.getByTestId('presence-dot:online:72')).toBeTruthy();
    expect(screen.getByLabelText('Online')).toBeTruthy();
    expect(screen.getByText('Minibits')).toBeTruthy();
    expect(screen.getByText('mint.minibits.cash')).toBeTruthy();
    expect(screen.queryByText('Operational')).toBeNull();
  });

  it('draws no dot for an unaudited mint or while loading', () => {
    render(<MintHeader name="https://mint.example" mintUrl="https://mint.example" />);
    expect(screen.queryByTestId('mint-info-health')).toBeNull();
    // A name that is only the address is not repeated as a host line.
    expect(screen.queryByText('mint.example')).toBeNull();

    render(
      <MintHeader
        name="https://mint.example"
        mintUrl="https://mint.example"
        health="operational"
        isLoading
      />
    );
    expect(screen.queryByTestId('mint-info-health')).toBeNull();
  });

  it('keeps the host line while the name is still loading, so it does not appear later', () => {
    render(<MintHeader name="https://mint.example" mintUrl="https://mint.example" isLoading />);
    expect(screen.getByText('mint.example')).toBeTruthy();
  });

  it.each([
    ['problems', 'degraded', 'Having problems'],
    ['offline', 'offline', 'Offline'],
  ] as const)(
    'maps %s to a %s presence dot with accessible label %s',
    (health, presence, label) => {
      render(<MintHeader name="Mint" health={health} />);
      expect(screen.getByTestId(`presence-dot:${presence}:72`)).toBeTruthy();
      expect(screen.getByLabelText(label)).toBeTruthy();
      expect(screen.queryByText(label)).toBeNull();
    }
  );
});
