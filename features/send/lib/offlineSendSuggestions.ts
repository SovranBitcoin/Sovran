type ProofAmount = {
  amount: number;
};

type OfflineProofService = {
  getReadyProofs: (mintUrl: string) => Promise<ProofAmount[]>;
  selectProofsToSend: (
    mintUrl: string,
    amount: number,
    includeFees: boolean
  ) => Promise<ProofAmount[]>;
};

export type OfflineSendSuggestions = {
  isRequestedAmountSendableOffline: boolean;
  roundDownAmount: number | null;
  roundUpAmount: number | null;
  totalReadyBalance: number;
};

export type ExactOfflineAmountIndex = {
  reachableSums: number[];
  totalReadyBalance: number;
};

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function sumProofAmounts(proofs: ProofAmount[]): number {
  return proofs.reduce((sum, proof) => sum + proof.amount, 0);
}

function buildReachableSums(proofAmounts: number[], maxAmount: number): number[] {
  const reachable = new Set<number>([0]);

  for (const proofAmount of proofAmounts) {
    const nextSums: number[] = [];
    for (const currentSum of reachable) {
      const nextSum = currentSum + proofAmount;
      if (nextSum <= maxAmount) {
        nextSums.push(nextSum);
      }
    }

    for (const nextSum of nextSums) {
      reachable.add(nextSum);
    }
  }

  return [...reachable].sort((a, b) => a - b);
}

export function buildExactOfflineAmountIndex(proofAmounts: number[]): ExactOfflineAmountIndex {
  const validProofAmounts = proofAmounts.filter((amount) => isPositiveInteger(amount));
  const totalReadyBalance = validProofAmounts.reduce((sum, amount) => sum + amount, 0);

  if (validProofAmounts.length === 0 || totalReadyBalance === 0) {
    return {
      reachableSums: [],
      totalReadyBalance,
    };
  }

  return {
    reachableSums: buildReachableSums(validProofAmounts, totalReadyBalance).filter(
      (sum) => sum > 0
    ),
    totalReadyBalance,
  };
}

function findInsertionIndex(sortedValues: number[], target: number): number {
  let low = 0;
  let high = sortedValues.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((sortedValues[mid] ?? 0) < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

async function isExactOfflineAmount(
  proofService: OfflineProofService,
  mintUrl: string,
  amount: number
): Promise<boolean> {
  if (!isPositiveInteger(amount)) return false;

  try {
    const selectedProofs = await proofService.selectProofsToSend(mintUrl, amount, false);
    return selectedProofs.length > 0 && sumProofAmounts(selectedProofs) === amount;
  } catch {
    return false;
  }
}

async function findNearestValidatedCandidate(
  proofService: OfflineProofService,
  mintUrl: string,
  candidates: number[]
): Promise<number | null> {
  for (const candidate of candidates) {
    if (await isExactOfflineAmount(proofService, mintUrl, candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function getOfflineSendSuggestions(
  proofService: OfflineProofService,
  mintUrl: string,
  requestedAmount: number
): Promise<OfflineSendSuggestions> {
  if (!isPositiveInteger(requestedAmount)) {
    return {
      isRequestedAmountSendableOffline: false,
      roundDownAmount: null,
      roundUpAmount: null,
      totalReadyBalance: 0,
    };
  }

  const readyProofs = await proofService.getReadyProofs(mintUrl);
  const { reachableSums, totalReadyBalance } = buildExactOfflineAmountIndex(
    readyProofs.map((proof) => proof.amount)
  );

  if (reachableSums.length === 0 || totalReadyBalance === 0) {
    return {
      isRequestedAmountSendableOffline: false,
      roundDownAmount: null,
      roundUpAmount: null,
      totalReadyBalance,
    };
  }

  const insertionIndex = findInsertionIndex(reachableSums, requestedAmount);

  const requestedCandidate = reachableSums[insertionIndex];
  const isRequestedReachable = requestedCandidate === requestedAmount;
  const isRequestedAmountSendableOffline = isRequestedReachable
    ? await isExactOfflineAmount(proofService, mintUrl, requestedAmount)
    : false;

  if (isRequestedAmountSendableOffline) {
    return {
      isRequestedAmountSendableOffline: true,
      roundDownAmount: null,
      roundUpAmount: null,
      totalReadyBalance,
    };
  }

  const lowerCandidates = reachableSums
    .slice(0, insertionIndex)
    .filter((candidate) => candidate < requestedAmount)
    .reverse();
  const upperCandidates = reachableSums
    .slice(isRequestedReachable ? insertionIndex + 1 : insertionIndex)
    .filter((candidate) => candidate > requestedAmount);

  const [roundDownAmount, roundUpAmount] = await Promise.all([
    findNearestValidatedCandidate(proofService, mintUrl, lowerCandidates),
    findNearestValidatedCandidate(proofService, mintUrl, upperCandidates),
  ]);

  return {
    isRequestedAmountSendableOffline: false,
    roundDownAmount,
    roundUpAmount,
    totalReadyBalance,
  };
}
