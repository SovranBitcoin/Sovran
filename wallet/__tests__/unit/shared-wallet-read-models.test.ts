import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import {
  act,
  createContext,
  createElement,
  useContext,
  type ReactElement,
} from "react";

// Use the app's already-declared renderer for these wallet hook tests. No
// renderer is shipped or added to the wallet package's dependencies.
interface TestRoot {
  update: (element: ReactElement) => void;
  unmount: () => void;
}
const { create }: { create: (element: ReactElement) => TestRoot } =
  createRequire(new URL("../../../app/package.json", import.meta.url))(
    "react-test-renderer",
  );
import { Amount, type Manager, type HistoryEntry } from "@cashu/coco-core";
import type { AnnotationStoreAdapter } from "../../src/annotations";
import { emitPaymentRequestCreated } from "../../src/paymentRequestEvents";
import { createInMemoryAnnotationStore } from "../../src/annotations/store";
import { useColadaBalance } from "../../src/react/useColadaBalance";
import { useColadaTransactions } from "../../src/react/useColadaTransactions";

vi.mock("../../src/react/ColadaProvider", () => ({
  useColadaManager: () => useContext(managerContext) ?? activeManager,
  useAnnotationStore: () => useContext(annotationContext) ?? annotations,
}));

function managerFixture() {
  const listeners = new Map<string, Set<() => void>>();
  const off = vi.fn((event: string, listener: () => void) => {
    listeners.get(event)?.delete(listener);
  });
  const manager = {
    wallet: {
      balances: {
        byMint: vi.fn(async (_scope: { units: string[] }) => ({
          "https://one.example": balance(100, 20),
          "https://two.example": balance(200, 30),
        })),
      },
    },
    history: {
      getPaginatedHistory: vi.fn(
        async (_offset: number, _limit: number): Promise<HistoryEntry[]> => [
          mint("first"),
        ],
      ),
    },
    ops: { receive: { listInFlight: vi.fn(async () => []) } },
    paymentRequests: { incoming: { list: vi.fn(async () => []) } },
    on: vi.fn((event: string, listener: () => void) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return () => off(event, listener);
    }),
    off,
  };
  return {
    manager,
    emit: (event: string) => {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    listenerCount: () =>
      [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}

function balance(spendable: number, reserved = 0) {
  return {
    spendable: Amount.from(spendable),
    reserved: Amount.from(reserved),
    total: Amount.from(spendable + reserved),
    unit: "sat",
  };
}

function mint(id: string): HistoryEntry {
  return {
    id,
    type: "mint",
    state: "pending",
    remoteState: "UNPAID",
    createdAt: 1000,
    mintUrl: "https://one.example",
    amount: Amount.from(1),
    unit: "sat",
    source: "operation",
    operationId: id,
    quoteId: id,
    paymentRequest: "",
    updatedAt: 1000,
  } as HistoryEntry;
}

const managerContext = createContext<Manager | null>(null);
const annotationContext = createContext<AnnotationStoreAdapter | null>(null);
let fixture = managerFixture();
let activeManager: Manager = fixture.manager as unknown as Manager;
let annotations = createInMemoryAnnotationStore();
const roots: TestRoot[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture = managerFixture();
  activeManager = fixture.manager as unknown as Manager;
  annotations = createInMemoryAnnotationStore();
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  vi.unstubAllGlobals();
});

async function mount<T>(
  read: () => T,
  count = 1,
  manager?: Manager,
  store?: AnnotationStoreAdapter,
) {
  const values: T[] = [];
  function Consumer({ index }: { index: number }) {
    values[index] = read();
    return null;
  }
  let root: TestRoot;
  const tree = (n: number) =>
    createElement(
      managerContext.Provider,
      { value: manager ?? null },
      createElement(
        annotationContext.Provider,
        { value: store ?? null },
        Array.from({ length: n }, (_, index) =>
          createElement(Consumer, { key: index, index }),
        ),
      ),
    );
  await act(async () => {
    root = create(tree(count));
    roots.push(root);
  });
  return {
    values,
    update: async (n = count) => {
      await act(async () => root.update(tree(n)));
    },
    unmount: async () => {
      await act(async () => root.unmount());
    },
  };
}

test("balance retains totals, predicate scoping and the last successful value on error", async () => {
  const include = (url: string) => url === "https://one.example";
  const mounted = await mount(() => useColadaBalance("sat", include));
  expect(mounted.values[0]).toMatchObject({
    spendable: 100,
    reserved: 20,
    total: 120,
    pending: 0,
    redeeming: 0,
  });
  expect(Object.keys(mounted.values[0].byMint)).toEqual([
    "https://one.example",
  ]);
  fixture.manager.wallet.balances.byMint.mockRejectedValueOnce(
    new Error("busy"),
  );
  await act(async () => fixture.emit("proofs:saved"));
  expect(mounted.values[0].total).toBe(120);
});

test("history preserves pagination, refresh and annotated list identity", async () => {
  const mounted = await mount(() => useColadaTransactions(1));
  expect(mounted.values[0]).toMatchObject({ hasMore: true, isFetching: false });
  expect(mounted.values[0].history.map((e) => e.id)).toEqual(["first"]);
  fixture.manager.history.getPaginatedHistory.mockResolvedValueOnce([
    mint("second"),
  ]);
  await act(async () => {
    await mounted.values[0].loadMore();
  });
  expect(mounted.values[0].history.map((e) => e.id)).toEqual([
    "first",
    "second",
  ]);
  const original = mounted.values[0].history;
  await act(async () =>
    annotations.set("id:unrelated", { distributionSource: "copy" }),
  );
  expect(mounted.values[0].history).toBe(original);
  await act(async () =>
    annotations.set("id:first", { distributionSource: "copy" }),
  );
  expect(
    mounted.values[0].history.find((e) => e.id === "first")?.metadata,
  ).toMatchObject({ distributionSource: "copy" });
  await act(async () => {
    await mounted.values[0].refresh();
  });
  expect(mounted.values[0].history.map((e) => e.id)).toEqual([
    "first",
    "second",
  ]);
});

test("seven balance consumers share initial and event reads", async () => {
  const mounted = await mount(() => useColadaBalance(), 7);
  expect(mounted.values.map((value) => value.total)).toEqual([
    350, 350, 350, 350, 350, 350, 350,
  ]);
  expect(fixture.manager.wallet.balances.byMint).toHaveBeenCalledTimes(1);
  expect(fixture.manager.history.getPaginatedHistory).toHaveBeenCalledTimes(1);
  expect(fixture.manager.ops.receive.listInFlight).toHaveBeenCalledTimes(1);
  await act(async () => fixture.emit("history:updated"));
  expect(fixture.manager.history.getPaginatedHistory).toHaveBeenCalledTimes(2);
  expect(fixture.manager.ops.receive.listInFlight).toHaveBeenCalledTimes(2);
});

test("seven history consumers share initial and event reads", async () => {
  const mounted = await mount(() => useColadaTransactions(), 7);
  expect(mounted.values.map((value) => value.history.map((e) => e.id))).toEqual(
    Array.from({ length: 7 }, () => ["first"]),
  );
  expect(fixture.manager.history.getPaginatedHistory).toHaveBeenCalledTimes(1);
  expect(fixture.manager.ops.receive.listInFlight).toHaveBeenCalledTimes(1);
  await act(async () => fixture.emit("history:updated"));
  expect(fixture.manager.history.getPaginatedHistory).toHaveBeenCalledTimes(2);
  expect(fixture.manager.ops.receive.listInFlight).toHaveBeenCalledTimes(2);
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("different units and predicate identities never share balance snapshots", async () => {
  fixture.manager.wallet.balances.byMint.mockImplementation(
    async ({ units }) => ({
      "https://one.example": balance(units[0] === "sat" ? 100 : 500),
      "https://two.example": balance(units[0] === "sat" ? 200 : 600),
    }),
  );
  const first = (url: string) => url === "https://one.example";
  const otherIdentity = (url: string) => url === "https://one.example";
  const second = (url: string) => url === "https://two.example";
  const sat = await mount(() => useColadaBalance("sat", first), 2);
  const usd = await mount(() => useColadaBalance("usd", first), 2);
  const sameMeaning = await mount(() => useColadaBalance("sat", otherIdentity));
  const different = await mount(() => useColadaBalance("sat", second));
  expect(sat.values[0].total).toBe(100);
  expect(usd.values[0].total).toBe(500);
  expect(sameMeaning.values[0].total).toBe(100);
  expect(different.values[0].total).toBe(200);
  expect(fixture.manager.wallet.balances.byMint).toHaveBeenCalledTimes(4);
});

test("different managers do not share either read model", async () => {
  const other = managerFixture();
  other.manager.wallet.balances.byMint.mockResolvedValue({
    "https://one.example": balance(800),
    "https://two.example": balance(900),
  });
  other.manager.history.getPaginatedHistory.mockResolvedValue([
    mint("other-account"),
  ]);
  const firstBalance = await mount(() => useColadaBalance(), 2, activeManager);
  const firstHistory = await mount(
    () => useColadaTransactions(),
    2,
    activeManager,
  );
  const manager = other.manager as unknown as Manager;
  const otherBalance = await mount(() => useColadaBalance(), 2, manager);
  const otherHistory = await mount(() => useColadaTransactions(), 2, manager);
  expect(firstBalance.values[0].total).toBe(350);
  expect(otherBalance.values[0].total).toBe(1700);
  expect(firstHistory.values[0].history.map((e) => e.id)).toEqual(["first"]);
  expect(otherHistory.values[0].history.map((e) => e.id)).toEqual([
    "other-account",
  ]);
  for (const { manager } of [fixture, other]) {
    expect(manager.wallet.balances.byMint).toHaveBeenCalledTimes(1);
    expect(manager.history.getPaginatedHistory).toHaveBeenCalledTimes(2);
    expect(manager.ops.receive.listInFlight).toHaveBeenCalledTimes(2);
  }
});

test("page sizes have independent pagination windows", async () => {
  const small = await mount(() => useColadaTransactions(1), 2);
  const large = await mount(() => useColadaTransactions(2), 2);
  expect(small.values[0].hasMore).toBe(true);
  expect(large.values[0].hasMore).toBe(false);
  expect(fixture.manager.history.getPaginatedHistory.mock.calls).toEqual([
    [0, 1],
    [0, 2],
  ]);
});

test.each(["balance", "history"])(
  "%s listeners live until the last consumer and remount reads fresh",
  async (kind) => {
    const read = () =>
      kind === "balance"
        ? useColadaBalance().total
        : useColadaTransactions().history.map((e) => e.id);
    const mounted = await mount(read, 7);
    const listeners = kind === "balance" ? 9 : 5;
    expect(fixture.manager.on).toHaveBeenCalledTimes(listeners);
    await mounted.update(1);
    expect(fixture.manager.off).toHaveBeenCalledTimes(0);
    expect(fixture.listenerCount()).toBe(listeners);
    await mounted.unmount();
    expect(fixture.manager.off).toHaveBeenCalledTimes(listeners);
    expect(fixture.listenerCount()).toBe(0);
    fixture.manager.wallet.balances.byMint.mockResolvedValue({
      "https://one.example": balance(10),
      "https://two.example": balance(20),
    });
    fixture.manager.history.getPaginatedHistory.mockResolvedValue([
      mint("fresh"),
    ]);
    const remount = await mount(read);
    expect(remount.values[0]).toEqual(kind === "balance" ? 30 : ["fresh"]);
    expect(fixture.manager.history.getPaginatedHistory).toHaveBeenCalledTimes(
      2,
    );
    expect(fixture.manager.ops.receive.listInFlight).toHaveBeenCalledTimes(2);
    await remount.unmount();
    expect(fixture.manager.on).toHaveBeenCalledTimes(listeners * 2);
    expect(fixture.manager.off).toHaveBeenCalledTimes(listeners * 2);
    expect(fixture.listenerCount()).toBe(0);
  },
);

test.each(["balance", "history"])(
  "late %s reads cannot publish or replay queued work after last unsubscribe",
  async (kind) => {
    const pending = deferred<HistoryEntry[]>();
    fixture.manager.history.getPaginatedHistory.mockReturnValueOnce(
      pending.promise,
    );
    const read = () =>
      kind === "balance"
        ? useColadaBalance().total
        : useColadaTransactions().history.map((e) => e.id);
    const mounted = await mount(read, 3);
    await act(async () => fixture.emit("history:updated"));
    await mounted.unmount();
    fixture.manager.wallet.balances.byMint.mockResolvedValue({
      "https://one.example": balance(10),
      "https://two.example": balance(20),
    });
    const fresh = await mount(read);
    expect(fresh.values[0]).toEqual(kind === "balance" ? 30 : ["first"]);
    await act(async () => pending.resolve([mint("late")]));
    expect(fresh.values[0]).toEqual(kind === "balance" ? 30 : ["first"]);
    expect(fixture.manager.history.getPaginatedHistory).toHaveBeenCalledTimes(
      2,
    );
  },
);

test("shared balance bursts discard invalidated results and run exactly one trailing read", async () => {
  const older =
    deferred<
      Awaited<ReturnType<typeof fixture.manager.wallet.balances.byMint>>
    >();
  const newer =
    deferred<
      Awaited<ReturnType<typeof fixture.manager.wallet.balances.byMint>>
    >();
  fixture.manager.wallet.balances.byMint
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(newer.promise);
  const mounted = await mount(() => useColadaBalance(), 7);
  await act(async () => {
    for (let i = 0; i < 20; i++) fixture.emit("proofs:saved");
  });
  expect(fixture.manager.wallet.balances.byMint).toHaveBeenCalledTimes(1);
  await act(async () =>
    older.resolve({
      "https://one.example": balance(10),
      "https://two.example": balance(20),
    }),
  );
  expect(mounted.values.map((v) => v.total)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  expect(fixture.manager.wallet.balances.byMint).toHaveBeenCalledTimes(2);
  await act(async () =>
    newer.resolve({
      "https://one.example": balance(100),
      "https://two.example": balance(200),
    }),
  );
  expect(mounted.values.map((v) => v.total)).toEqual([
    300, 300, 300, 300, 300, 300, 300,
  ]);
  expect(fixture.manager.history.getPaginatedHistory).toHaveBeenCalledTimes(2);
  expect(fixture.manager.ops.receive.listInFlight).toHaveBeenCalledTimes(2);
});

test("shared pagination keeps one trailing history refresh and preserves loaded pages", async () => {
  const mounted = await mount(() => useColadaTransactions(1), 7);
  const pending = deferred<HistoryEntry[]>();
  fixture.manager.history.getPaginatedHistory.mockReturnValueOnce(
    pending.promise,
  );
  let loading = Promise.resolve();
  await act(async () => {
    loading = mounted.values[0].loadMore();
  });
  await act(async () => {
    for (let i = 0; i < 20; i++) fixture.emit("history:updated");
  });
  expect(fixture.manager.history.getPaginatedHistory).toHaveBeenCalledTimes(2);
  await act(async () => {
    pending.resolve([mint("second")]);
    await loading;
  });
  expect(fixture.manager.history.getPaginatedHistory.mock.calls).toEqual([
    [0, 1],
    [1, 1],
    [0, 1],
  ]);
  expect(mounted.values.map((v) => v.history.map((e) => e.id))).toEqual(
    Array.from({ length: 7 }, () => ["first", "second"]),
  );
});

test.each(["manager", "unit", "predicate"])(
  "a balance %s switch hides old values on every render before the fresh read",
  async (scope) => {
    let unit = "sat";
    let include: (url: string) => boolean = (url) =>
      url === "https://one.example";
    const rendered: number[] = [];
    const mounted = await mount(() => {
      const value = useColadaBalance(unit, include);
      rendered.push(value.total);
      return value;
    });
    expect(mounted.values[0].total).toBe(120);
    const pending =
      deferred<
        Awaited<ReturnType<typeof fixture.manager.wallet.balances.byMint>>
      >();
    if (scope === "manager") {
      const next = managerFixture();
      next.manager.wallet.balances.byMint.mockReturnValueOnce(pending.promise);
      activeManager = next.manager as unknown as Manager;
    } else {
      fixture.manager.wallet.balances.byMint.mockReturnValueOnce(
        pending.promise,
      );
      if (scope === "unit") unit = "usd";
      else include = (url: string) => url === "https://two.example";
    }
    rendered.length = 0;
    await mounted.update();
    expect(rendered).not.toEqual([]);
    expect(rendered.every((value) => value === 0)).toBe(true);
    await act(async () =>
      pending.resolve({
        "https://one.example": balance(10),
        "https://two.example": balance(20),
      }),
    );
    expect(mounted.values[0].total).toBe(scope === "predicate" ? 20 : 10);
  },
);

test.each(["manager", "pageSize"])(
  "a history %s switch cannot render the old scope before its fresh read",
  async (scope) => {
    let pageSize = 100;
    const rendered: string[][] = [];
    const mounted = await mount(() => {
      const value = useColadaTransactions(pageSize);
      rendered.push(value.history.map((e) => e.id));
      return value;
    });
    expect(mounted.values[0].history.map((e) => e.id)).toEqual(["first"]);
    const pending = deferred<HistoryEntry[]>();
    if (scope === "manager") {
      const next = managerFixture();
      next.manager.history.getPaginatedHistory.mockReturnValueOnce(
        pending.promise,
      );
      activeManager = next.manager as unknown as Manager;
    } else {
      fixture.manager.history.getPaginatedHistory.mockReturnValueOnce(
        pending.promise,
      );
      pageSize = 2;
    }
    rendered.length = 0;
    await mounted.update();
    expect(rendered).not.toEqual([]);
    expect(rendered.every((value) => value.length === 0)).toBe(true);
    await act(async () => pending.resolve([mint("new-scope")]));
    expect(mounted.values[0].history.map((e) => e.id)).toEqual(["new-scope"]);
  },
);

test("separate annotation adapters share Coco reads and retain their own metadata", async () => {
  const otherAnnotations = createInMemoryAnnotationStore();
  otherAnnotations.set("id:first", { distributionSource: "copy" });
  const first = await mount(
    () => useColadaTransactions(),
    2,
    activeManager,
    annotations,
  );
  const other = await mount(
    () => useColadaTransactions(),
    2,
    activeManager,
    otherAnnotations,
  );
  expect(
    first.values[0].history[0].metadata?.distributionSource,
  ).toBeUndefined();
  expect(other.values[0].history[0].metadata).toMatchObject({
    distributionSource: "copy",
  });
  expect(fixture.manager.history.getPaginatedHistory).toHaveBeenCalledTimes(1);
  expect(fixture.manager.ops.receive.listInFlight).toHaveBeenCalledTimes(1);
  await first.unmount();
  expect(fixture.manager.off).toHaveBeenCalledTimes(0);
  await act(async () =>
    otherAnnotations.set("id:first", { distributionSource: "displayed" }),
  );
  expect(other.values[0].history[0].metadata).toMatchObject({
    distributionSource: "displayed",
  });
  await other.unmount();
  expect(fixture.manager.off).toHaveBeenCalledTimes(5);
});

test("receive bursts share independent supplements and retire the payment-request signal", async () => {
  const first = deferred<never[]>();
  const trailing = deferred<never[]>();
  fixture.manager.ops.receive.listInFlight
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(trailing.promise);
  const mounted = await mount(() => useColadaTransactions(), 7);
  await act(async () => {
    for (let i = 0; i < 20; i++) fixture.emit("receive-op:finalized");
  });
  expect(fixture.manager.ops.receive.listInFlight).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve([]));
  expect(fixture.manager.ops.receive.listInFlight).toHaveBeenCalledTimes(2);
  expect(mounted.values.map((v) => v.isFetching)).toEqual([
    true,
    true,
    true,
    true,
    true,
    true,
    true,
  ]);
  await act(async () => trailing.resolve([]));
  expect(mounted.values.map((v) => v.isFetching)).toEqual([
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
  expect(mounted.values[0].history.map((e) => e.id)).toEqual(["first"]);
  await act(async () => emitPaymentRequestCreated());
  expect(fixture.manager.paymentRequests.incoming.list).toHaveBeenCalledTimes(
    3,
  );
  expect(fixture.manager.history.getPaginatedHistory).toHaveBeenCalledTimes(1);
  await mounted.unmount();
  await act(async () => emitPaymentRequestCreated());
  expect(fixture.manager.ops.receive.listInFlight).toHaveBeenCalledTimes(3);
});
