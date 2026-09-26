/**
 * Stand-in for `@nostr-dev-kit/ndk-mobile` under Jest.
 *
 * The real package ships only an ESM `exports` map with a React Native build,
 * which Jest's CJS resolver here cannot load ("Cannot find module"). Nine
 * suites already stubbed it per-file with `jest.mock(..., { virtual: true })`;
 * this is the same stub once, mapped through `moduleNameMapper`, so a component
 * that reaches the Nostr data layer through a shared hook (ContactRow reading
 * the entity cache) does not force every suite that renders it to know about
 * NDK. A suite's own `jest.mock` of the package only takes precedence
 * when it is not `virtual`.
 *
 * It proves nothing about NDK: relay URLs pass through unchanged, `useNDK`
 * reports no client, and the classes are empty shells for `instanceof` and
 * construction only.
 */

/**
 * The shape the outbox code relies on: lower-cased, `ws(s)://` only, no
 * trailing slash. Note a suite's own `jest.mock(..., { virtual: true })` of
 * this package does NOT override the mapped stub — a virtual mock registers
 * under the unresolved specifier while `require` resolves through the mapper —
 * so anything a suite needs from the package has to behave here.
 */
export function normalizeRelayUrl(url: string): string {
  const trimmed = url.trim().toLowerCase();
  if (!/^wss?:\/\//.test(trimmed)) throw new Error(`invalid relay url: ${url}`);
  return trimmed.replace(/\/+$/, '');
}

export function useNDK(): { ndk: undefined } {
  return { ndk: undefined };
}

export class NDKEvent {}
export class NDKRelay {}
export class NDKUser {}
export class NDKPrivateKeySigner {}
export class NDKRelaySet {}

export enum NDKKind {
  Metadata = 0,
  Text = 1,
  Contacts = 3,
}

export enum NDKSubscriptionCacheUsage {
  CACHE_FIRST = 'CACHE_FIRST',
  ONLY_CACHE = 'ONLY_CACHE',
  ONLY_RELAY = 'ONLY_RELAY',
  PARALLEL = 'PARALLEL',
}

export default class NDK {}
