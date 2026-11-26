import { bech32 } from "@scure/base";
import { describe, expect, it } from "vitest";

import { extractLightningTarget } from "../../src/lightning-target";

const lnurl = (url: string) =>
  bech32.encode("lnurl", bech32.toWords(new TextEncoder().encode(url)), 2048);

describe("extractLightningTarget", () => {
  it("returns a plain lightning address", () => {
    expect(extractLightningTarget({ lud16: "alice@example.com" })).toBe(
      "alice@example.com",
    );
  });

  it("trims whitespace and strips a leading lightning: scheme", () => {
    expect(extractLightningTarget({ lud16: "  alice@example.com \n" })).toBe(
      "alice@example.com",
    );
    expect(
      extractLightningTarget({ lud16: "lightning:alice@example.com" }),
    ).toBe("alice@example.com");
    expect(
      extractLightningTarget({ lud16: " LIGHTNING: alice@example.com " }),
    ).toBe("alice@example.com");
  });

  it("allows + tags in the local part", () => {
    expect(extractLightningTarget({ lud16: "user+tag@domain.com" })).toBe(
      "user+tag@domain.com",
    );
  });

  it("accepts a published npub.cash address as an ordinary target", () => {
    expect(extractLightningTarget({ lud16: "alice@npub.cash" })).toBe(
      "alice@npub.cash",
    );
  });

  it("accepts a valid lnurl1 in lud16 or lud06", () => {
    const encoded = lnurl("https://example.com/.well-known/lnurlp/alice");
    expect(extractLightningTarget({ lud16: encoded })).toBe(encoded);
    expect(extractLightningTarget({ lud06: encoded })).toBe(encoded);
    expect(
      extractLightningTarget({ lud06: `lightning:${encoded.toUpperCase()}` }),
    ).toBe(encoded.toUpperCase());
  });

  it("prefers lud16 over lud06", () => {
    const encoded = lnurl("https://example.com/.well-known/lnurlp/alice");
    expect(
      extractLightningTarget({ lud16: "alice@example.com", lud06: encoded }),
    ).toBe("alice@example.com");
  });

  it("falls through to lud06 when lud16 is unusable", () => {
    const encoded = lnurl("https://example.com/.well-known/lnurlp/alice");
    expect(
      extractLightningTarget({ lud16: "not an address", lud06: encoded }),
    ).toBe(encoded);
  });

  it("rejects junk, bad lnurls and insecure lnurl urls", () => {
    expect(extractLightningTarget({})).toBeNull();
    expect(extractLightningTarget({ lud16: "   ", lud06: null })).toBeNull();
    expect(extractLightningTarget({ lud16: "lnurl1notbech32!!" })).toBeNull();
    expect(
      extractLightningTarget({ lud06: lnurl("http://example.com/pay") }),
    ).toBeNull();
    expect(extractLightningTarget({ lud16: "alice@" })).toBeNull();
  });
});
