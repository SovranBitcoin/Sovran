// ---------------------------------------------------------------------------
// Mint picker rows — one rule set for every frame
//
// The picker paints synchronous rows from the wallet context, then replaces
// them with rows enriched from fresh mint info. Both ask this module whether a
// row can be picked and why not, so the first frame already says what the last
// one will; enrichment is left to fill in names, icons and scores.
// ---------------------------------------------------------------------------

import { defaultDetectors } from "./detectors";
import { localizeReason } from "./formatting";
import { buildMethodAwareMintCandidates } from "./mint-capabilities";
import type { StepDataMap } from "./machine/types";
import type { MintListItem, WalletContext } from "./types";

type MintRowVerdict = Pick<MintListItem, "status" | "reason">;

/** A spend draws on the mint's balance; a receive, or a pick with no flow, does not. */
function spendsFromMint(data: StepDataMap["selectMint"]): boolean {
  return (
    data.destination === "paymentRequest" ||
    data.destination === "meltQuote" ||
    data.destination === "sendEcash"
  );
}

export function createMintRowRules({
  data,
  capabilityCtx,
  crossesAccounts,
  supportsWebsocket,
}: {
  data: StepDataMap["selectMint"];
  capabilityCtx: Pick<
    WalletContext,
    "trustedMintUrls" | "mintBalances" | "mintMethodCapabilities"
  >;
  /** The mint is on the other side of the testnut split from the active account. */
  crossesAccounts: (mintUrl: string) => boolean;
  /** NUT-17 support; `undefined` while the mint's info is not known yet. */
  supportsWebsocket: (mintUrl: string) => boolean | undefined;
}): (mintUrl: string, balance: number) => MintRowVerdict {
  // The wallet's own picker: a pick moves the wallet to that mint (and with it
  // to that mint's account), so nothing about a flow can rule a mint out.
  const ownPicker = data.scope === "selected";
  const skipBalanceCheck =
    !spendsFromMint(data) || ownPicker || data.scope === "npc";

  const requestInfo = data.paymentRequest
    ? defaultDetectors.getPaymentRequestInfo(data.paymentRequest)
    : null;
  const preferredSet =
    requestInfo?.mintsPreferred && requestInfo.mints.length
      ? new Set(requestInfo.mints)
      : null;
  const supportedSet = data.supportedMintUrls
    ? new Set(data.supportedMintUrls)
    : null;

  const methodCandidates = data.methodRequirement
    ? buildMethodAwareMintCandidates(capabilityCtx, data.methodRequirement, {
        amount: data.amount,
        allowedMints: data.supportedMintUrls,
        requireBalance: spendsFromMint(data),
      })
    : data.candidates;
  const candidateByMint = new Map(
    methodCandidates.map((candidate) => [candidate.mintUrl, candidate]),
  );
  const flowCandidates = new Set(data.candidates.map((c) => c.mintUrl));

  return (mintUrl, balance) => {
    const disabled = (reason: MintListItem["reason"]): MintRowVerdict => ({
      status: "disabled",
      reason,
    });
    const candidate = candidateByMint.get(mintUrl);

    // Test and real funds never meet in one payment. The row is still listed,
    // under its own unit tab (TSAT, TUSD): the picker shows every trusted mint.
    if (!ownPicker && crossesAccounts(mintUrl)) {
      return disabled({
        code: "MINT_OUTSIDE_ACCOUNT",
        message: "Mint belongs to a different account (test vs real funds)",
      });
    }
    // NPC receive only works against mints that speak NUT-17 websockets: the
    // npub.cash plugin learns a quote settled over the mint's websocket.
    if (data.scope === "npc" && supportsWebsocket(mintUrl) === false) {
      return disabled({
        code: "NO_WEBSOCKET",
        message: "Does not support live updates (NUT-17)",
      });
    }
    if (supportedSet && !supportedSet.has(mintUrl)) {
      return disabled({
        code: "NOT_IN_PAYMENT_REQUEST",
        message: "Not accepted by payment request",
      });
    }
    if (candidate?.status === "disabled") {
      return disabled(
        candidate.reason ?? {
          code: "UNSUPPORTED_FOR_FLOW",
          message: "Unsupported for this flow",
        },
      );
    }
    if (!skipBalanceCheck && data.amount && balance < data.amount) {
      return disabled({
        code: "INSUFFICIENT_BALANCE",
        message: "Insufficient balance",
      });
    }
    if (!skipBalanceCheck && !flowCandidates.has(mintUrl) && balance <= 0) {
      return disabled({ code: "NO_BALANCE", message: "No balance" });
    }
    return {
      status: "available",
      reason:
        preferredSet && !preferredSet.has(mintUrl)
          ? localizeReason("MINT_NOT_PREFERRED")
          : null,
    };
  };
}
