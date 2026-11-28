import type { Manager } from "@cashu/coco-core";
import { AuthoredError } from "../errors";
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
export class PaymentRequestFeesUnsupportedError extends AuthoredError {
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
 * NUT-18 requires the amount the receiver gets after redemption fees. The
 * NFC, Nostr and HTTP request sends prepare a gross amount, so a mint whose
 * keysets charge input fees is refused before any proofs are reserved.
 * Coco 58abfae does offer the net contract: `ops.send.prepare({ …,
 * coverReceiverFees: true })` (coco api/SendOpsApi.ts:25,84,
 * SendOperationService.ts:283), which its own HTTP request path uses
 * (PaymentRequestService.ts:223). Switching to it makes fee-charging mints
 * payable, so it is the owner's decision, not a refactor. Ordinary token
 * sends are separate.
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
