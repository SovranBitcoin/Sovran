/**
 * `ColadaProvider` takes its settings from the `createColada` instance: the
 * machine it builds reads the wallet context, locale, offline flag, fiat
 * rate and memo switch from `instance`, and the screens below it read the
 * same locale, offline flag, BTC price, display currency and Coco manager
 * through the provider. The annotation store is the one the app hands the
 * provider. The real provider and machine run; only the machine factory is
 * wrapped so the configuration it receives can be read back.
 */
import { createRequire } from "node:module";
import { act, createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ColadaInstance } from "../../src/core/createColada";
import type { CreateMachineConfig } from "../../src/machine/types";
import type { WalletContext } from "../../src/types";

const captured = vi.hoisted(() => ({
  config: null as CreateMachineConfig | null,
}));
vi.mock("../../src/machine/createMachine", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/machine/createMachine")>();
  return {
    ...actual,
    createPaymentMachine: (config: CreateMachineConfig) => {
      captured.config = config;
      return actual.createPaymentMachine(config);
    },
  };
});

import {
  ColadaProvider,
  useAnnotationStore,
  useColadaContext,
  useColadaManager,
} from "../../src/react/ColadaProvider";
import { createInMemoryAnnotationStore } from "../../src/annotations";

interface TestRoot {
  unmount: () => void;
}
const { create }: { create: (element: ReactElement) => TestRoot } =
  createRequire(new URL("../../../app/package.json", import.meta.url))(
    "react-test-renderer",
  );

const WALLET = {
  trustedMintUrls: ["https://mint.example"],
  mintBalances: { "https://mint.example": 21 },
  proofAmounts: { "https://mint.example": [1, 4, 16] },
} as unknown as WalletContext;

function instanceFixture() {
  const manager = { kind: "coco manager" };
  return {
    manager,
    instance: {
      config: {
        manager,
        getLocale: () => "de",
        getOffline: () => true,
        getBtcPrice: () => 50_000,
        getDisplayCurrency: () => ({ code: "EUR", symbol: "€" }),
        getSatsPerUnitMinor: (unit: string) => (unit === "eur" ? 2 : null),
        enableEcashSendMemo: true,
      },
      tracker: { getContext: () => WALLET },
      getWalletContext: () => WALLET,
      subscribeWalletContext: () => () => undefined,
      operations: {},
      dispose: () => undefined,
    } as unknown as ColadaInstance,
  };
}

const roots: TestRoot[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  captured.config = null;
});

async function mount(instance: ColadaInstance, annotationStore: unknown) {
  const seen: {
    context?: ReturnType<typeof useColadaContext>;
    manager?: unknown;
    annotationStore?: unknown;
  } = {};
  function Probe() {
    seen.context = useColadaContext();
    seen.manager = useColadaManager();
    seen.annotationStore = useAnnotationStore();
    return null;
  }
  await act(async () => {
    roots.push(
      create(
        createElement(ColadaProvider, {
          handlers: () => ({}),
          instance,
          annotationStore: annotationStore as never,
          children: createElement(Probe),
        }),
      ),
    );
  });
  return seen;
}

describe("ColadaProvider reads its settings from the instance", () => {
  it("builds the machine on the instance's context, locale, offline flag, rate and memo switch", async () => {
    const { instance } = instanceFixture();
    await mount(instance, createInMemoryAnnotationStore());

    const config = captured.config!;
    expect(config.getContext()).toBe(WALLET);
    expect(config.getLocale?.()).toBe("de");
    expect(config.getOffline?.()).toBe(true);
    expect(config.getSatsPerUnitMinor?.("eur")).toBe(2);
    expect(config.getSatsPerUnitMinor?.("sat")).toBeNull();
    expect(config.enableEcashSendMemo).toBe(true);
  });

  it("gives screens the instance's locale, offline flag, price, currency and manager", async () => {
    const { instance, manager } = instanceFixture();
    const annotationStore = createInMemoryAnnotationStore();
    const seen = await mount(instance, annotationStore);

    const ctx = seen.context!;
    expect(ctx.getLocaleRef.current?.()).toBe("de");
    expect(ctx.getOfflineRef.current?.()).toBe(true);
    expect(ctx.getBtcPriceRef.current?.()).toBe(50_000);
    expect(ctx.getDisplayCurrencyRef.current?.()).toEqual({
      code: "EUR",
      symbol: "€",
    });
    expect(seen.manager).toBe(manager);
    expect(seen.annotationStore).toBe(annotationStore);
  });
});
