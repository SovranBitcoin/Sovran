import type { Manager } from "@cashu/coco-core";
import { getMintKeysets } from "./keysetUnits";

type PaymentRequestFeesUnsupportedCode =
  /** The mint's keysets could not be loaded, so fees are unknown. */
  | "keysets-unavailable"
  /** The mint charges redemption fees (or has no keyset for the unit). */
  | "redemption-fees";

/**
 * Thrown before any proofs are reserved when a NUT-18 payment request can't
 * be paid from this mint. `code` says why; `cause` keeps the underlying
 * keyset-load failure for `keysets-unavailable`.
 */
export class PaymentRequestFeesUnsupportedError extends Error {
  readonly code: PaymentRequestFeesUnsupportedCode;
  readonly mintUrl: string;
  readonly unit: string;

  constructor(
    code: PaymentRequestFeesUnsupportedCode,
    details: { mintUrl: string; unit: string },
    options?: { cause?: unknown },
  ) {
    super(
      code === "keysets-unavailable"
        ? "Unable to verify mint redemption fees. Try again before paying this request."
        : "This payment request needs a mint without ecash redemption fees. Choose another mint or ask for a Lightning invoice.",
      options,
    );
    this.name = "PaymentRequestFeesUnsupportedError";
    this.code = code;
    this.mintUrl = details.mintUrl;
    this.unit = details.unit;
  }
}

/**
 * Coco 2.0.0 sends a gross amount and exposes no recipient-fee option. NUT-18
 * requires the amount after redemption fees. Reject before reserving proofs
 * until durable sends support that contract; ordinary token sends are separate.
 */
export async function assertPaymentRequestFeesSupported(
  manager: Manager,
  mintUrl: string,
  unit: string,
): Promise<void> {
  const knownKeysets = await getMintKeysets(manager, mintUrl).catch(
    (cause: unknown) => {
      throw new PaymentRequestFeesUnsupportedError(
        "keysets-unavailable",
        { mintUrl, unit },
        { cause },
      );
    },
  );
  const keysets = knownKeysets.filter(
    (keyset) =>
      (keyset.unit || "sat").toLowerCase() === unit.trim().toLowerCase(),
  );
  // Include inactive keysets: an exact-match send may use their existing proofs.
  if (keysets.length === 0 || keysets.some((keyset) => keyset.feePpk !== 0)) {
    throw new PaymentRequestFeesUnsupportedError("redemption-fees", {
      mintUrl,
      unit,
    });
  }
}
