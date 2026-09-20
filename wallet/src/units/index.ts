// The wallet's unit vocabulary, importable on its own as `wallet/units`: which
// units exist (registry), how a testnut mint's units split into accounts, and
// how a unit's amounts denominate. Dependency-free on purpose, so a store or a
// formatter can use it without loading the payment machine behind `wallet`.
export {
  FIAT_UNITS,
  isSwitchableUnit,
  SWITCHABLE_UNITS,
  unitDefinition,
  type FiatUnit,
  type SwitchableUnit,
} from "./registry";
export {
  ACCOUNT_UNITS,
  accountUnitLabel,
  accountUnitName,
  isAccountUnit,
  isTestnutUnit,
  toAccountUnit,
  toRealUnit,
  type AccountUnit,
  type TestnutUnit,
} from "./accounts";
export {
  isFiatUnit,
  majorToMinor,
  minorToRawInput,
  unitMinorDecimals,
  unitSymbol,
} from "../formatting/units";
