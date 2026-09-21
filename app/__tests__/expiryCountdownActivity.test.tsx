import { AppState } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import type { HistoryEntry } from '@cashu/coco-core';
import { NavigationContext } from 'expo-router/react-navigation';

import { ExpiryCountdown } from '@/features/transactions/components/detail/timeline/ExpiryCountdown';

jest.mock('expo-router/react-navigation', () => ({
  NavigationContext: jest.requireActual('react').createContext(undefined),
}));

const NOW_MS = 1_800_000_000_000;

/** Only the fields the countdown reads are built. */
function historyEntry(fields: Partial<HistoryEntry>): HistoryEntry {
  return fields as HistoryEntry;
}
function meltQuote(fields: Partial<MeltQuoteBolt11Response>): MeltQuoteBolt11Response {
  return fields as MeltQuoteBolt11Response;
}

const meltEntry = historyEntry({ type: 'melt' });
const quoteExpiringIn = (seconds: number) => meltQuote({ expiry: NOW_MS / 1000 + seconds });

function renderCountdown(meltQuote: MeltQuoteBolt11Response) {
  let focused = true;
  const listeners = new Map<string, () => void>();
  const navigation = {
    isFocused: () => focused,
    addListener: (event: string, fn: () => void) => {
      listeners.set(event, fn);
      return () => listeners.delete(event);
    },
  };
  render(
    // Only the focus contract is needed by the countdown.
    // @ts-expect-error Deliberately minimal navigation provider for lifecycle events.
    <NavigationContext.Provider value={navigation}>
      <ExpiryCountdown
        historyEntry={meltEntry}
        meltQuote={meltQuote}
        isOnchainMint={false}
        color="white"
        entryId="entry-1"
      />
    </NavigationContext.Provider>
  );
  return {
    setFocused(next: boolean) {
      focused = next;
      act(() => listeners.get(next ? 'focus' : 'blur')?.());
    },
  };
}

/** The Text primitive's host node is not a native Text under the uniwind mock. */
const renderedText = () => JSON.stringify(screen.toJSON());

/** Running 1s ticks: intervals started minus intervals cleared. */
const runningTicks = () =>
  jest.mocked(setInterval).mock.calls.length - jest.mocked(clearInterval).mock.calls.length;

describe('ExpiryCountdown tick', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW_MS);
    jest.spyOn(global, 'setInterval');
    jest.spyOn(global, 'clearInterval');
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('pauses while its screen is blurred and catches up on focus', () => {
    const countdown = renderCountdown(quoteExpiringIn(60));
    act(() => jest.advanceTimersByTime(2000));
    expect(renderedText()).toContain('expires in 58s');

    countdown.setFocused(false);
    expect(runningTicks()).toBe(0);
    act(() => jest.advanceTimersByTime(5000));
    expect(renderedText()).toContain('expires in 58s');

    countdown.setFocused(true);
    expect(renderedText()).toContain('expires in 53s');
  });

  it('stops ticking once the quote has expired', () => {
    renderCountdown(quoteExpiringIn(2));
    act(() => jest.advanceTimersByTime(3000));
    expect(renderedText()).not.toContain('expires in');
    expect(runningTicks()).toBe(0);
  });
});
