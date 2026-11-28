/** @jest-environment node */
import type { AppStateStatus } from 'react-native';
import { NostrClient } from 'nostr/client';

import { pauseInBackground } from '@/shared/lib/nostr/pauseInBackground';

// Audit D8: the account's relay client must go quiet in the background. The
// real NostrClient runs over a fake WebSocket that refuses every connection.

class DeadSocket {
  static dials = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  constructor() {
    DeadSocket.dials += 1;
    queueMicrotask(() => this.onerror?.({}));
  }
  send() {}
  close() {}
}

function appStateDouble(initial: AppStateStatus) {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const source = {
    currentState: initial,
    addEventListener: (_type: 'change', listener: (state: AppStateStatus) => void) => {
      listeners.add(listener);
      return { remove: () => void listeners.delete(listener) };
    },
  };
  return {
    source,
    listeners,
    set(state: AppStateStatus) {
      source.currentState = state;
      for (const listener of [...listeners]) listener(state);
    },
  };
}

const client = () =>
  new NostrClient({
    relays: ['wss://dead.test'],
    WebSocketImpl: DeadSocket as unknown as new (url: string) => never,
    random: () => 1,
  });

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  DeadSocket.dials = 0;
});
afterEach(() => {
  jest.useRealTimers();
});

it('a dead relay is not redialled while the app is in the background, and is redialled on return', async () => {
  const app = appStateDouble('active');
  const nostr = client();
  const stop = pauseInBackground(nostr, app.source);
  await jest.advanceTimersByTimeAsync(3_000);
  expect(DeadSocket.dials).toBe(2);

  app.set('background');
  await jest.advanceTimersByTimeAsync(30 * 60_000);
  // Half an hour in the background: not one dial. Every 3 s it was 600.
  expect(DeadSocket.dials).toBe(2);

  app.set('active');
  expect(DeadSocket.dials).toBe(3);
  stop();
  nostr.dispose();
});

it('the app switcher (inactive) does not pause the client', async () => {
  const app = appStateDouble('active');
  const nostr = client();
  const stop = pauseInBackground(nostr, app.source);
  app.set('inactive');
  expect(nostr.paused).toBe(false);
  app.set('background');
  expect(nostr.paused).toBe(true);
  // Returning through `inactive` on the way to `active` stays paused until active.
  app.set('inactive');
  expect(nostr.paused).toBe(true);
  app.set('active');
  expect(nostr.paused).toBe(false);
  stop();
  nostr.dispose();
});

it('a client created while already in the background starts paused, and stop removes the listener', () => {
  const app = appStateDouble('background');
  const nostr = client();
  const stop = pauseInBackground(nostr, app.source);
  expect(nostr.paused).toBe(true);
  stop();
  expect(app.listeners.size).toBe(0);
  app.set('active');
  expect(nostr.paused).toBe(true);
  nostr.dispose();
});
