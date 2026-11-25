import { accountUnitLabel, unitMinorDecimals } from 'wallet/units';

/**
 * What spending a mint's ecash costs, in the words Mint Details uses. Pure:
 * the keysets come from the caller.
 */
/** A unit's spending fee: NUT-02 `input_fee_ppk`, parts per thousand of the unit per input. */
export interface UnitInputFee {
  unit: string;
  ppk: number;
}

interface KeysetFeeFields {
  unit?: string | null;
  active?: boolean | null;
  /** Coco's local keyset field. */
  feePpk?: number | null;
  /** The mint's `/v1/keysets` field. */
  input_fee_ppk?: number | null;
}

/**
 * The fee a new payment from each unit pays, from the ACTIVE keysets only
 * (inactive ones only hold old ecash). Where a unit has more than one active
 * keyset the highest fee is shown, so the figure is never an understatement.
 * A keyset that states no fee charges none (NUT-02 defaults it to 0).
 */
export function activeInputFees(keysets: readonly KeysetFeeFields[]): UnitInputFee[] {
  const byUnit = new Map<string, number>();
  for (const keyset of keysets) {
    if (keyset.active === false) continue;
    const unit = (keyset.unit || 'sat').trim().toLowerCase();
    if (!unit) continue;
    const raw = keyset.feePpk ?? keyset.input_fee_ppk ?? 0;
    const ppk = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
    byUnit.set(unit, Math.max(byUnit.get(unit) ?? 0, ppk));
  }
  return [...byUnit.entries()]
    .map(([unit, ppk]) => ({ unit, ppk }))
    .sort((a, b) => a.unit.localeCompare(b.unit));
}

/**
 * `sat: no spending fee`, or `sat: 0.1 sat per coin spent` for 100 ppk. A
 * fiat unit's amounts are its minor unit (cents), so its fee is said in the
 * currency: 100 ppk of `usd` is `0.001 USD`, not `0.1`. The mint rounds the
 * total for a payment up to a whole unit.
 */
export function formatInputFee({ unit, ppk }: UnitInputFee): string {
  if (ppk <= 0) return `${unit}: no spending fee`;
  const decimals = unitMinorDecimals(unit);
  const perInput = Number((ppk / (1000 * 10 ** decimals)).toFixed(3 + decimals));
  // Sats keep their own name: the account label for `sat` is BTC.
  const label = decimals > 0 ? accountUnitLabel(unit) : unit;
  return `${unit}: ${perInput} ${label} per coin spent`;
}
