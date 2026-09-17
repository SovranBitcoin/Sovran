/**
 * Registration of Sovran's generic NUT-04 mint handler.
 *
 * coco only ships handlers for bolt11/bolt12/onchain, so a mint that
 * advertises anything else (mint.sortug.com serves venmo and paypal) fails at
 * quote creation with "No mint handler registered for method …". The patch in
 * `app/patches/@cashu+coco-core+2.0.0.patch` exposes coco's runtime registry;
 * these tests pin what the app is allowed to do with it.
 *
 * The quote/claim behaviour of the handler itself is not unit-testable here —
 * it needs a live mint and coco's durable saga — so what is pinned is the part
 * that can silently go wrong: which methods get a handler, whose NUT-20
 * keyring they use, and what happens on an unpatched install.
 */

import type { Manager } from '@cashu/coco-core';

import {
  getRegisteredMintMethods,
  registerGenericMintMethods,
} from '@/shared/lib/cashu/genericMintMethod';

const keyRingService = {
  generateMintQuoteKeyPair: jest.fn(),
  getMintQuoteKeyPair: jest.fn(),
};

interface ProviderShape {
  getAll(): Record<string, unknown>;
  register(method: string, handler: unknown): void;
}

/**
 * coco's `Manager` type does not admit a stub, and the registry the app
 * reaches for is added by the patch rather than declared on it — so the cast
 * lives here, on a parameter rather than an object literal, and nowhere else
 * in this file.
 */
function asManager(value: object): Manager {
  return value as Manager;
}

function providerOf(manager: Manager): ProviderShape {
  return (manager as unknown as { mintHandlerProvider: ProviderShape }).mintHandlerProvider;
}

/** Stands in for coco's `MintHandlerProvider` plus the built-ins it ships. */
function fakeManager(): Manager {
  const registry: Record<string, unknown> = {
    bolt11: { keyRingService },
    onchain: { keyRingService },
    bolt12: { keyRingService },
  };
  return asManager({
    mintHandlerProvider: {
      getAll: () => registry,
      register: (method: string, handler: unknown) => {
        registry[method] = handler;
      },
    },
  });
}

describe('registerGenericMintMethods', () => {
  it('registers a handler for each method coco does not already serve', () => {
    const manager = fakeManager();

    expect(registerGenericMintMethods(manager, ['venmo', 'paypal'])).toEqual(['venmo', 'paypal']);
    expect(getRegisteredMintMethods(manager)).toEqual([
      'bolt11',
      'onchain',
      'bolt12',
      'venmo',
      'paypal',
    ]);
  });

  it('never replaces a built-in handler, even if a mint advertises it', () => {
    const manager = fakeManager();
    const before = providerOf(manager).getAll().bolt11;

    expect(registerGenericMintMethods(manager, ['bolt11', 'onchain'])).toEqual([]);
    expect(providerOf(manager).getAll().bolt11).toBe(before);
  });

  it('is idempotent, so it can run on every trusted-mint change', () => {
    const manager = fakeManager();
    registerGenericMintMethods(manager, ['venmo']);

    expect(registerGenericMintMethods(manager, ['venmo'])).toEqual([]);
    expect(getRegisteredMintMethods(manager).filter((m) => m === 'venmo')).toHaveLength(1);
  });

  it('borrows the built-in handlers keyring so NUT-20 quote keys are claimable', () => {
    // A handler with its own keyring would generate quote keys coco cannot
    // find at claim time, stranding every locked quote it created.
    const manager = fakeManager();
    registerGenericMintMethods(manager, ['venmo']);
    const handler = providerOf(manager).getAll().venmo as { keyRingService: unknown };

    expect(handler.keyRingService).toBe(keyRingService);
  });

  it('registers nothing when coco is unpatched, rather than throwing', () => {
    const unpatched = asManager({});

    expect(registerGenericMintMethods(unpatched, ['venmo'])).toEqual([]);
    expect(getRegisteredMintMethods(unpatched)).toEqual([]);
  });

  it('registers nothing when no built-in handler can lend a keyring', () => {
    const manager = asManager({
      mintHandlerProvider: { getAll: () => ({}), register: jest.fn() },
    });

    expect(registerGenericMintMethods(manager, ['venmo'])).toEqual([]);
  });
});
