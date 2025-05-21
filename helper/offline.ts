import { useEffect, useState } from 'react';
import * as Network from 'expo-network';

export interface OfflineValidationResult {
  canPay: boolean;
  underpay?: number;
  overpay?: number;
}

interface Proof {
  id: string;
  amount: number;
}

interface Keyset {
  id: string;
  unit: string;
}

export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = async () => {
      try {
        const state = await Network.getNetworkStateAsync();
        setOnline(state.isConnected && state.isInternetReachable !== false);
      } catch {
        setOnline(true);
      }
    };
    update();
    const interval = setInterval(update, 5000);
    return () => clearInterval(interval);
  }, []);

  return online;
}

function evaluateProofs(proofs: Proof[], amount: number) {
  let reachable = new Set<number>([0]);
  let over = Infinity;
  for (const p of proofs) {
    const next = new Set<number>(reachable);
    for (const s of reachable) {
      const sum = s + p.amount;
      next.add(sum);
      if (sum >= amount && sum < over) over = sum;
    }
    reachable = next;
  }
  const arr = Array.from(reachable);
  const exact = arr.includes(amount);
  const under = Math.max(...arr.filter((v) => v < amount), 0);
  return { exact, under, over };
}

export function validateOfflinePayment(
  amount: number,
  unit: string,
  proofs: Proof[],
  keysets: Keyset[]
): OfflineValidationResult {
  let canPay = false;
  let bestUnder: number | null = null;
  let bestOver: number | null = null;

  keysets
    .filter((ks) => ks.unit === unit)
    .forEach((ks) => {
      const kp = proofs.filter((p) => p.id === ks.id);
      if (kp.length === 0) return;
      const { exact, under, over } = evaluateProofs(kp, amount);
      if (exact) {
        canPay = true;
      } else {
        if (under > 0) {
          const diff = amount - under;
          if (bestUnder === null || diff < bestUnder) bestUnder = diff;
        }
        if (over < Infinity) {
          const diff = over - amount;
          if (bestOver === null || diff < bestOver) bestOver = diff;
        }
      }
    });

  return {
    canPay,
    underpay: bestUnder !== null ? bestUnder : undefined,
    overpay: bestOver !== null ? bestOver : undefined,
  };
}
