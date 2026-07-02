import { describe, expect, it } from "vitest";

import { buildUnifiedBip321Uri } from "../../src/bip321";

describe("buildUnifiedBip321Uri", () => {
  it("composes address body + lno + creq keys", () => {
    const uri = buildUnifiedBip321Uri({
      address: "bc1qexample",
      lno: "lno1offer",
      creq: "CREQB1REQUEST",
    });
    expect(uri).toBe("bitcoin:bc1qexample?lno=lno1offer&creq=CREQB1REQUEST");
  });

  it("allows an empty body when only params exist (NUT-26 example shape)", () => {
    expect(buildUnifiedBip321Uri({ creq: "CREQB1X" })).toBe(
      "bitcoin:?creq=CREQB1X",
    );
  });

  it("percent-encodes non-URI-safe values (creqA base64)", () => {
    const uri = buildUnifiedBip321Uri({ creq: "creqAab+c/d=" });
    expect(uri).toContain("creq=creqAab%2Bc%2Fd%3D");
  });

  it("returns null when nothing is available", () => {
    expect(buildUnifiedBip321Uri({})).toBeNull();
    expect(buildUnifiedBip321Uri({ address: "  ", lno: "" })).toBeNull();
  });

  it("orders keys lightning, lno, creq and skips blanks", () => {
    const uri = buildUnifiedBip321Uri({
      address: "bc1q",
      lightning: "lnbc1invoice",
      lno: null,
      creq: "CREQB1X",
    });
    expect(uri).toBe("bitcoin:bc1q?lightning=lnbc1invoice&creq=CREQB1X");
  });
});
