import { useEffect, useSyncExternalStore } from 'react';

// Bluetooth is the largest constant radio cost the app owns, so nearby
// discovery runs only while a view that shows nearby people is open
// (ADR 0023, amended 2026-11-28). Views hold the radio; the account's
// discovery owner starts it for the first holder and stops it after the last.

let holders = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Ask for nearby discovery until the returned release is called. */
export function holdNearbyRadio(): () => void {
  holders += 1;
  if (holders === 1) notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) notify();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether any open view wants nearby discovery. Read by the discovery owner. */
export function useNearbyRadioWanted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => holders > 0,
    () => false
  );
}

/** Keeps nearby discovery running while the calling view is mounted. */
export function useNearbyRadio(): void {
  useEffect(() => holdNearbyRadio(), []);
}
