import { afterEach, describe, expect, it } from "vitest";
import {
  configureEnabledPaymentMethods,
  isMethodImplemented,
} from "../src/mint-capabilities";

describe("configureEnabledPaymentMethods", () => {
  afterEach(() => configureEnabledPaymentMethods(["bolt11", "bolt12", "onchain"]));

  it("rules out methods the build does not ship", () => {
    configureEnabledPaymentMethods(["onchain"]);
    expect(isMethodImplemented({ method: "onchain", operation: "mint", unit: "sat" })).toBe(true);
    expect(isMethodImplemented({ method: "bolt11", operation: "melt", unit: "sat" })).toBe(false);
  });
});
