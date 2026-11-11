/**
 * `useColadaTransactionAnnotation` mounted against a real in-memory annotation
 * store: what a transaction row or detail screen reads for its entry, how a
 * write to the store reaches it, which key wins when several hold data, and
 * what a missing entry or missing annotation reads as.
 *
 * Writes go through the store adapter, the way the app writes (its own
 * persisted adapter).
 */
import { createRequire } from "node:module";
import {
  act,
  createContext,
  createElement,
  useContext,
  type ReactElement,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  encodeAnnotation,
  type AnnotationEntryLike,
  type AnnotationStoreAdapter,
  type TransactionAnnotation,
} from "../../src/annotations";
import { createInMemoryAnnotationStore } from "../../src/annotations/store";
import { useColadaTransactionAnnotation } from "../../src/react/useColadaTransactionAnnotation";

interface TestRoot {
  update: (element: ReactElement) => void;
  unmount: () => void;
}
const { create }: { create: (element: ReactElement) => TestRoot } =
  createRequire(new URL("../../../app/package.json", import.meta.url))(
    "react-test-renderer",
  );

const storeContext = createContext<AnnotationStoreAdapter | null>(null);
vi.mock("../../src/react/ColadaProvider", () => ({
  useAnnotationStore: () => useContext(storeContext),
}));

/** A real in-memory store that also counts its live subscribers. */
function countingStore() {
  const inner = createInMemoryAnnotationStore();
  let listeners = 0;
  const store: AnnotationStoreAdapter = {
    ...inner,
    subscribe: (listener) => {
      listeners += 1;
      const off = inner.subscribe(listener);
      return () => {
        listeners -= 1;
        off();
      };
    },
  };
  return { store, listeners: () => listeners };
}

type Entry = AnnotationEntryLike | null | undefined;

const roots: TestRoot[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
});

async function mount(store: AnnotationStoreAdapter, entry: Entry) {
  const seen: TransactionAnnotation[] = [];
  function Probe(props: { entry: Entry }) {
    seen.push(useColadaTransactionAnnotation(props.entry));
    return null;
  }
  const tree = (s: AnnotationStoreAdapter, e: Entry) =>
    createElement(
      storeContext.Provider,
      { value: s },
      createElement(Probe, { entry: e }),
    );
  let root!: TestRoot;
  await act(async () => {
    root = create(tree(store, entry));
  });
  roots.push(root);
  return {
    seen,
    latest: () => seen[seen.length - 1]!,
    rerender: (e: Entry, s: AnnotationStoreAdapter = store) =>
      act(async () => root.update(tree(s, e))),
    unmount: async () => {
      await act(async () => root.unmount());
      roots.splice(roots.indexOf(root), 1);
    },
  };
}

const write = (
  store: AnnotationStoreAdapter,
  key: string,
  patch: TransactionAnnotation,
) => act(async () => store.set(key, encodeAnnotation(patch)));

const ALICE = { counterparty: { displayName: "Alice" } };
const BOB = { counterparty: { displayName: "Bob" } };

describe("reading an annotation for a transaction", () => {
  it("reads an empty annotation for no entry, and keeps that one object", async () => {
    const { store } = countingStore();
    const view = await mount(store, null);
    expect(view.latest()).toEqual({});
    await write(store, "id:anything", ALICE);
    await view.rerender(undefined);
    expect(new Set(view.seen).size).toBe(1);
  });

  it("reads an empty annotation for an entry with nothing written", async () => {
    const { store } = countingStore();
    const view = await mount(store, { id: "send:op-1", type: "send" });
    expect(view.latest()).toEqual({});
  });

  it("shows a write under the entry's operation key without a remount", async () => {
    const { store } = countingStore();
    const view = await mount(store, {
      id: "send:op-1",
      type: "send",
      operationId: "op-1",
    });
    await write(store, "op:op-1", ALICE);
    expect(view.latest()).toEqual(ALICE);
  });

  it("finds a write under the bare id key", async () => {
    const { store } = countingStore();
    store.set("id:tx-7", encodeAnnotation(ALICE));
    const view = await mount(store, { id: "tx-7" });
    expect(view.latest()).toEqual(ALICE);
  });

  it("merges fields across keys, with quote: over op: over id: on conflict", async () => {
    const { store } = countingStore();
    store.set(
      "id:op-9",
      encodeAnnotation({ ...BOB, distribution: { source: "airdrop" } }),
    );
    store.set("op:op-9", encodeAnnotation(BOB));
    store.set("quote:q-9", encodeAnnotation(ALICE));
    const view = await mount(store, {
      id: "op-9",
      type: "melt",
      quoteId: "q-9",
      metadata: { operationId: "op-9" },
    });
    expect(view.latest().counterparty).toEqual(ALICE.counterparty);
    expect(view.latest().distribution).toEqual({ source: "airdrop" });
  });

  it("does not hand back a new object when an unrelated key changes", async () => {
    const { store } = countingStore();
    store.set("op:op-1", encodeAnnotation(ALICE));
    const view = await mount(store, { id: "send:op-1", operationId: "op-1" });
    const first = view.latest();
    await write(store, "op:someone-else", BOB);
    expect(view.latest()).toBe(first);
  });

  it("resolves again when the entry gains an operation id", async () => {
    const { store } = countingStore();
    store.set("op:op-5", encodeAnnotation(ALICE));
    const view = await mount(store, { id: "local-5" });
    expect(view.latest()).toEqual({});
    await view.rerender({ id: "local-5", metadata: { operationId: "op-5" } });
    expect(view.latest()).toEqual(ALICE);
  });

  it("reads from the new store when the provider's store changes", async () => {
    const a = countingStore();
    const b = countingStore();
    a.store.set("op:op-1", encodeAnnotation(ALICE));
    b.store.set("op:op-1", encodeAnnotation(BOB));
    const view = await mount(a.store, { operationId: "op-1" });
    expect(view.latest()).toEqual(ALICE);
    await view.rerender({ operationId: "op-1" }, b.store);
    expect(view.latest()).toEqual(BOB);
    expect(a.listeners()).toBe(0);
  });

  it("stops listening to the store on unmount", async () => {
    const { store, listeners } = countingStore();
    const view = await mount(store, { operationId: "op-1" });
    expect(listeners()).toBe(1);
    await view.unmount();
    expect(listeners()).toBe(0);
  });
});
