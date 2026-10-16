import {
  HttpResponseError,
  KeysetSyncError,
  MintFetchError,
  NetworkError,
} from "@cashu/coco-core";
import { describe, expect, it } from "vitest";

import { isMintOfflineError } from "../../src/errors";

describe("isMintOfflineError", () => {
  it.each([
    ["a network failure", new NetworkError("Network request failed")],
    ["a mint server error", new HttpResponseError("Bad gateway", 502)],
    ["a failed mint refresh", new MintFetchError("https://mint.test")],
    [
      "a failed keyset sync",
      new KeysetSyncError("https://mint.test", "00ad268c4d1f5826"),
    ],
    [
      "a network failure wrapped by another error",
      new Error("Send failed", {
        cause: new NetworkError("Network request failed"),
      }),
    ],
  ])("treats %s as an unreachable mint", (_label, error) => {
    expect(isMintOfflineError(error)).toBe(true);
  });

  it.each([
    ["a mint refusal", new HttpResponseError("Token already spent", 400)],
    [
      "a plain error",
      new Error("Offline send needs proofs that add up to exactly 35 sat"),
    ],
    ["a non-error", "Network request failed"],
    ["nothing", undefined],
  ])("does not treat %s as an unreachable mint", (_label, error) => {
    expect(isMintOfflineError(error)).toBe(false);
  });

  it("stops walking a cause chain that loops", () => {
    const error = new Error("outer");
    (error as { cause?: unknown }).cause = error;
    expect(isMintOfflineError(error)).toBe(false);
  });
});
