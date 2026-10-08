import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';

import { CopyableValue } from '@/shared/ui/composed/CopyableValue';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { DetailsSheetContent, DetailsTable } from '@/shared/ui/composed/DetailsSheet';

jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { push: jest.fn(), back: jest.fn() },
}));
// The footer is the shared ButtonHandler; here it only needs to be pressable.
jest.mock('@/shared/ui/composed/ButtonHandler', () => ({
  ButtonHandler: ({
    buttons,
  }: {
    buttons: { text: string; testID?: string; condition?: boolean; onPress?: () => void }[];
  }) => {
    // Required at render: react-native is not ready while this factory runs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactActual = require('react') as typeof import('react');
    return buttons
      .filter((button) => button.condition !== false)
      .map((button) =>
        ReactActual.createElement('View', {
          key: button.testID,
          testID: button.testID,
          accessibilityLabel: button.text,
          onPress: button.onPress,
        })
      );
  },
}));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children, footer }: { children?: unknown; footer?: unknown }) => [children, footer],
  useScreenOptions: jest.fn(),
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: ({ children }: { children?: unknown }) => children,
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/Haptics', () => ({
  EnhancedHaptics: { copyHaptic: jest.fn(async () => undefined) },
}));
jest.mock('@/shared/ui/composed/CopyableValue', () => ({ CopyableValue: () => null }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    Array.isArray(tokens) ? tokens.map(() => 'rgb(128,128,128)') : 'rgb(128,128,128)',
}));

const ITEMS = [
  { title: 'State', value: 'PAID' },
  { title: 'Quote ID', value: <CopyableValue value="quote-000021" copyTarget="token" /> },
  { title: 'Invoice', value: '' },
  { title: 'Mint', value: <></> },
];

beforeEach(() => jest.mocked(Clipboard.setStringAsync).mockClear());

describe('transaction details', () => {
  it('copies a text value when its row is tapped', async () => {
    render(<DetailsTable items={ITEMS} />);
    fireEvent.press(screen.getByLabelText('State: PAID'));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('PAID'));
  });

  it('copies the full value behind a shortened one', async () => {
    render(<DetailsTable items={ITEMS} />);
    fireEvent.press(screen.getByLabelText('Quote ID: quote-000021'));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('quote-000021'));
  });

  it('leaves out a fact with no value, and keeps one it cannot read as text', () => {
    render(<DetailsTable items={ITEMS} />);
    expect(screen.queryByText('Invoice')).toBeNull();
    expect(screen.getByText('Mint')).toBeTruthy();
  });

  it('copies every text value at once from the open sheet', async () => {
    render(<DetailsSheetContent onClose={jest.fn()} items={ITEMS} />);
    fireEvent.press(screen.getByLabelText('Copy all'));
    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith('State: PAID\nQuote ID: quote-000021')
    );
  });

  it('leaves an unredeemed token out of Copy all', async () => {
    // Copy all is what gets pasted into a bug report, and a token is money to
    // whoever reads it. Its own row still copies it, on purpose.
    render(
      <DetailsSheetContent
        onClose={jest.fn()}
        items={[...ITEMS, { title: 'Token', value: 'cashuBbearer', bearer: true }]}
      />
    );
    fireEvent.press(screen.getByLabelText('Copy all'));
    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith('State: PAID\nQuote ID: quote-000021')
    );
    fireEvent.press(screen.getByLabelText('Token: cashuBbearer'));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('cashuBbearer'));
  });

  it('keeps the sheet closed until its row is tapped', () => {
    render(<DetailsSection items={ITEMS} />);
    expect(screen.getByLabelText('Details')).toBeTruthy();
    expect(screen.queryByLabelText('Copy all')).toBeNull();
  });

  it('draws no row of its own when the screen opens it from elsewhere', () => {
    const onOpenChange = jest.fn();
    render(
      <DetailsSection items={ITEMS} trigger="none" open={false} onOpenChange={onOpenChange} />
    );
    expect(screen.queryByLabelText('Details')).toBeNull();
  });
});
