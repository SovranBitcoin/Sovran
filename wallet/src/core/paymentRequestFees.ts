import type { Manager } from "@cashu/coco-core";
import { getMintKeysets } from "./keysetUnits";

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
  const knownKeysets = await getMintKeysets(manager, mintUrl).catch(() => {
    throw new Error(
      "Unable to verify mint redemption fees. Try again before paying this request.",
    );
  });
  const keysets = knownKeysets.filter(
    (keyset) =>
      (keyset.unit || "sat").toLowerCase() === unit.trim().toLowerCase(),
  );
  // Include inactive keysets: an exact-match send may use their existing proofs.
  if (keysets.length === 0 || keysets.some((keyset) => keyset.feePpk !== 0)) {
    throw new Error(
      "This payment request needs a mint without ecash redemption fees. Choose another mint or ask for a Lightning invoice.",
    );
  }
}
