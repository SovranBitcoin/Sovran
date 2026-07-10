import { describe, expect, it } from "vitest";

import { INPUTS } from "../_harness/fixtures";
import { meltMethodForTarget } from "../../src/melt-target";

describe("meltMethodForTarget", () => {
  it.each([
    [INPUTS.onchainAddress, "onchain"],
    [INPUTS.bolt12Offer, "bolt12"],
    [INPUTS.bolt11WithAmount, "bolt11"],
    ["alice@example.com", "bolt11"],
  ] as const)("classifies %s as %s", (target, expected) => {
    expect(meltMethodForTarget(target)).toBe(expected);
  });

  it("does not reuse the previous target classification", () => {
    expect(meltMethodForTarget(INPUTS.onchainAddress)).toBe("onchain");
    expect(meltMethodForTarget(INPUTS.bolt11WithAmount)).toBe("bolt11");
    expect(meltMethodForTarget(INPUTS.onchainAddress)).toBe("onchain");
  });

  it.each(["", "   ", INPUTS.npub, "https://mint.example.com"])(
    "rejects non-payable target %s",
    (target) => {
      expect(meltMethodForTarget(target)).toBeNull();
    },
  );
});
