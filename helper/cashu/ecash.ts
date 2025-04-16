import {
  getDecodedToken,
  getEncodedToken,
  PaymentRequest,
  PaymentRequestTransport,
  PaymentRequestTransportType,
  Token,
} from "@cashu/cashu-ts";
import { getWallet } from ".";
import {
  appendProofsV2,
  appendTransaction,
  increaseCounterV2,
  memoizedGetBalance,
  memoizedGetCounterV2,
  memoizedGetProofs,
  memoizedGetSelectedMint,
  removeProofs,
  updateTransaction
} from "helper/redux/cashu";
import { store } from "helper/redux/store";
import { AppError } from "components/cashu";
import { giveaways } from "./secrets";
import { publishWalletEvent } from "../nostr/cashu";
import { nip19 } from "nostr-tools";
import { v4 as uuidv4 } from "uuid";
import { showMessage } from "../popup/popups";
import { SheetManager } from "react-native-actions-sheet";

interface SendEcashProps {
  amount: number;
  unit: string;
  to?: string;
  isSell?: boolean;
  note?: string;
  pubkey?: string;
}

interface ReceiveEcashProps {
  token: string;
  unit: string;
  isBuy?: boolean | string;
  from?: string;
  isCancel?: boolean;
  isRefund?: boolean;
  isSweep?: boolean;
  note?: string;
  isNpubcash?: boolean;
  trust?: boolean;
}

interface PaymentRequestProps {
  amount: number;
  unit: string;
  description: string;
  singleUse?: boolean;
}

type SendEcashResponse = string;

export async function sendEcash({
  amount,
  unit,
  to,
  isSell = false,
  note,
  pubkey,
}: SendEcashProps): Promise<SendEcashResponse> {
  const state = store.getState();
  const selectedMint = memoizedGetSelectedMint(state);
  const proofs = memoizedGetProofs(unit)(state);
  const balance = memoizedGetBalance(unit)(state);
  const profileId = state.nostr?.currentProfile?.id;

  if (amount > balance) {
    throw new AppError("insufficient_funds", "Insufficient funds");
  }

  const wallet = await getWallet({
    unit,
    mintUrl: selectedMint,
    profile: null,
  });

  if (!wallet) {
    throw new AppError("wallet_not_found", "Wallet not found");
  }

  try {
    const counter = memoizedGetCounterV2({
      profileId,
      mintUrl: wallet.mint.mintUrl,
      keysetId: wallet.keysetId,
    })(state);

    const { keep, send } = await wallet.send(Number(amount), proofs, {
      ...(pubkey ? { pubkey } : {}),
      counter,
    });

    await store.dispatch(
      removeProofs({
        profileId,
        mintUrl: wallet.mint.mintUrl,
        proofs: send,
      })
    );

    await store.dispatch(
      appendProofsV2({
        profileId,
        mintUrl: wallet.mint.mintUrl,
        proofs: keep,
      })
    );

    const token: Token = {
      proofs: send,
      mint: wallet.mint.mintUrl,
      unit,
    };

    store.dispatch(
      increaseCounterV2({
        profileId,
        mintUrl: wallet.mint.mintUrl,
        keysetId: wallet.keysetId,
        amount: send.length + keep.length,
      })
    );

    const encodedToken = getEncodedToken(token, {
      version: 4,
    });

    store.dispatch(
      appendTransaction({
        profileId,
        transaction: {
          amount,
          date: new Date().toISOString(),
          type: "ecash",
          token: encodedToken,
          transactionType: "send",
          unit,
          nostr: {
            pubkey: to,
          },
          isSell,
          note,
          mintUrl: wallet.mint.mintUrl,
          counter,
          proofs: {
            send,
            keep
          }
        },
      })
    );

    return encodedToken;
  } catch (error) {
    throw new AppError(error.message, error.message);
  }
}

export async function receiveEcash({
  token,
  unit,
  isBuy = false,
  isCancel = false,
  isRefund = false,
  isSweep = false,
  lnurl,
  from = "Unknown",
  note,
  trust = false,
}: ReceiveEcashProps): Promise<any> {
  try {
    const state = store.getState();
    const profileId = state.nostr?.currentProfile?.id;
    const decodedToken = getDecodedToken(token);
    const receiveMintUrl = decodedToken.mint;

    // Extract private key if it's a giveaway token
    const giveaway = Object.values(giveaways).find((g) => {
      const pubkey = g.public_key;
      return decodedToken.proofs.some((proof) => {
        let parsed;
        try {
          parsed = JSON.parse(proof.secret);
        } catch (e) {
          parsed = proof.secret;
        }
        return (
          Array.isArray(parsed) &&
          parsed[0] === "P2PK" &&
          parsed[1].data === pubkey
        );
      });
    });

    const wallet = await getWallet({
      unit,
      mintUrl: receiveMintUrl,
      profile: null,
    });

    if (!wallet) {
      throw new AppError("wallet_not_found", "Wallet not found");
    }

    const counter = memoizedGetCounterV2({
      profileId,
      mintUrl: receiveMintUrl,
      keysetId: wallet.keysetId,
    })(state);

    const response = await wallet.receive(token, {
      counter,
      ...(giveaway ? { privkey: giveaway.private_key } : {}),
    });

    if (!response) {
      throw new AppError("invalid_token", "Invalid token");
    }

    const newProofs = [...response];

    store.dispatch(
      increaseCounterV2({
        profileId,
        mintUrl: receiveMintUrl,
        keysetId: wallet.keysetId,
        amount: newProofs.length,
      })
    );

    await store.dispatch(
      appendProofsV2({ profileId, mintUrl: receiveMintUrl, proofs: newProofs })
    );

    const totalAmount = decodedToken.proofs
      .map((p) => p.amount)
      .reduce((a, b) => a + b, 0);

    const newTransaction: Transaction = {
      amount: totalAmount,
      date: new Date().toISOString(),
      type: "ecash",
      token,
      transactionType: "receive",
      unit,
      isBuy,
      isCancel,
      isRefund,
      isSweep,
      note,
      mintUrl: receiveMintUrl,
      paid: true,
      privkey: giveaway?.private_key,
      counter,
      nostr: {
        pubkey: from,
      },
      proofs: {
        keep: newProofs,
      },
      lnurl
    };

    store.dispatch(
      appendTransaction({
        profileId,
        transaction: newTransaction,
      })
    );

    await publishWalletEvent(
      state.cashu?.profiles?.[profileId]?.transactions.map((t) => t.mintUrl)
    );

    return newTransaction;
  } catch (error) {
    throw new AppError(error.message, error.message);
  }
}

export async function getPaymentRequest({
  amount,
  unit,
  description,
  singleUse = true,
}: PaymentRequestProps): Promise<PaymentRequest> {
  const state = store.getState();
  const mint = memoizedGetSelectedMint(state);
  const currentProfile = state.nostr?.currentProfile;
  const nprofile = nip19.nprofileEncode({
    pubkey: currentProfile?.pubkey,
  });

  return new PaymentRequest(
    [
      {
        type: PaymentRequestTransportType.NOSTR,
        target: nprofile,
        tags: [["n", "17"]],
      } as PaymentRequestTransport,
    ],
    uuidv4(),
    amount,
    unit,
    [mint],
    description,
    singleUse
  );
}

export async function cancelEcashTransaction(
  transaction: Transaction,
  navigation: any
): Promise<void> {
  try {
    await receiveEcash({
      token: transaction.token as string,
      unit: transaction.unit,
      isRefund: true,
    });

    const profileId = store.getState().nostr?.currentProfile?.id;
    store.dispatch(
      updateTransaction({
        profileId,
        matcher: (t: Transaction) => t.token === transaction.token,
        updateFn: (t: Transaction) => ({
          ...t,
          paid: true,
          isCancel: true,
        }),
      })
    );

    SheetManager.hide("button-handler");
    navigation.navigate("", {}, { closeParents: true });
  } catch (error) {
    showMessage(error.message, {}, { emoji: "🚨" });
  }
}