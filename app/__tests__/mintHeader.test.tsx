/**
 * Mint Info's header: the auditor's state in plain words, and a status line
 * that keeps its place (invisible) for a mint nobody has audited.
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
jest.mock('@/shared/ui/primitives/Text', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    Text: ({ children }: { children: import('react').ReactNode }) =>
      createElement('Text', null, children),
  };
});
jest.mock('@/shared/ui/primitives/View/View', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return { View: () => createElement('View', null) };
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
  it('shows the 72pt icon, the name, the host and how the mint is running', () => {
    render(
      <MintHeader
        name="Minibits"
        mintUrl="https://mint.minibits.cash/Bitcoin"
        health="operational"
      />
    );
    expect(screen.getByTestId('mint-icon:72:ready')).toBeTruthy();
    expect(screen.getByText('Minibits')).toBeTruthy();
    expect(screen.getByText('mint.minibits.cash')).toBeTruthy();
    const line = screen.getByTestId('mint-info-health');
    expect(line.props.accessibilityLabel).toBe('Status: Operational');
    expect(line.props.className).toContain('h-[22px]');
  });

  it('keeps the status line in place, hidden from screen readers, until there is an audit', () => {
    render(<MintHeader name="https://mint.example" mintUrl="https://mint.example" />);
    const line = screen.getByTestId('mint-info-health', { includeHiddenElements: true });
    expect(line.props.className).toContain('h-[22px]');
    expect(line.props.accessibilityElementsHidden).toBe(true);
    expect(line.props.importantForAccessibility).toBe('no-hide-descendants');
    // A name that is only the address is not repeated as a host line.
    expect(screen.queryByText('mint.example')).toBeNull();
  });

  it.each([
    ['problems', 'Having problems'],
    ['offline', 'Offline'],
  ] as const)('says %s in plain words', (health, words) => {
    render(<MintHeader name="Mint" health={health} />);
    expect(screen.getByText(words)).toBeTruthy();
  });
});
