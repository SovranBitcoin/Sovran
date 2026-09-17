/**
 * Presentation for NUT-04/NUT-05 payment methods, including ones no NUT names.
 *
 * NUT-04 pins `method` to `[a-z0-9_-]+` and nothing else: a mint may advertise
 * any method it can settle, and the wallet only learns the name from that
 * mint's NUT-06 info. Three methods have their own spec (NUT-23 `bolt11`,
 * NUT-25 `bolt12`, NUT-30 `onchain`); everything else — `mint.sortug.com`
 * serves `venmo` and `paypal` — arrives as a bare string the wallet has never
 * seen before.
 *
 * So this module answers "how do I show a method I may not know?" in one
 * place: a curated table for names that are already out there, and a
 * mechanical fallback (`snake_case` → `Snake case`, generic glyph) for the
 * rest. A new method a mint invents tomorrow renders as a legible row without
 * a release; adding it to the table only upgrades the wording and the icon.
 *
 * Icons are iconify names resolved through the app's committed registry
 * (`app/assets/icons`), so every name used here must also be listed in that
 * registry's `icons` array — an unlisted name renders the "missing" glyph.
 * The `simple-icons:` family is monochrome and paints with `currentColor`,
 * which is what lets these tint correctly in both themes.
 */

import { isBuiltInMintPaymentMethod, type MintPaymentMethod } from "./types";

export interface PaymentMethodPresentation {
  /** Title-case name for buttons, rows and menu items ("PayPal"). */
  label: string;
  /** Iconify name; must exist in the app's committed icon registry. */
  icon: string;
  /** Sentence fragment for "Create a … receive request" style copy. */
  noun: string;
}

/**
 * Fallback glyph for a method with no table entry. A generic value-transfer
 * symbol rather than a question mark: an unknown method is still a real way
 * to get paid, and the row is not an error state.
 */
export const UNKNOWN_PAYMENT_METHOD_ICON = "mdi:bank-transfer";

/**
 * Methods seen in the wild, plus the three built-ins.
 *
 * Entries exist to fix two things the mechanical fallback gets wrong:
 * capitalisation that is part of a brand ("PayPal", not "Paypal") and a
 * recognisable glyph. Keep the keys lowercase — NUT-04 method names are
 * compared lowercased throughout.
 */
const PRESENTATION: Record<string, PaymentMethodPresentation> = {
  // ── Built-ins (their own NUTs) ────────────────────────────────────
  bolt11: {
    label: "Lightning",
    icon: "mingcute:lightning-fill",
    noun: "Lightning invoice",
  },
  bolt12: {
    label: "BOLT 12",
    icon: "mingcute:lightning-fill",
    noun: "BOLT 12 offer",
  },
  onchain: {
    label: "Onchain",
    icon: "hugeicons:blockchain-01",
    noun: "onchain address",
  },

  // ── Custom methods ────────────────────────────────────────────────
  // Consumer payment apps. `mint.sortug.com` is the first mint observed
  // advertising any of these (venmo/usd and paypal/sat, NUT-04 only).
  paypal: {
    label: "PayPal",
    icon: "simple-icons:paypal",
    noun: "PayPal request",
  },
  venmo: { label: "Venmo", icon: "simple-icons:venmo", noun: "Venmo request" },
  cashapp: {
    label: "Cash App",
    icon: "simple-icons:cashapp",
    noun: "Cash App request",
  },
  zelle: { label: "Zelle", icon: "simple-icons:zelle", noun: "Zelle request" },
  revolut: {
    label: "Revolut",
    icon: "simple-icons:revolut",
    noun: "Revolut request",
  },
  wise: { label: "Wise", icon: "simple-icons:wise", noun: "Wise request" },
  alipay: {
    label: "Alipay",
    icon: "simple-icons:alipay",
    noun: "Alipay request",
  },
  wechat: {
    label: "WeChat Pay",
    icon: "simple-icons:wechat",
    noun: "WeChat Pay request",
  },
  pix: { label: "Pix", icon: "simple-icons:pix", noun: "Pix request" },
  stripe: {
    label: "Stripe",
    icon: "simple-icons:stripe",
    noun: "Stripe request",
  },
  swish: { label: "Swish", icon: "mdi:bank-transfer", noun: "Swish request" },

  // Bank rails. Names vary by mint, so the common spellings all map to the
  // same presentation rather than falling through to the generic label.
  sepa: {
    label: "SEPA",
    icon: "ic:baseline-account-balance",
    noun: "SEPA transfer",
  },
  ach: {
    label: "ACH",
    icon: "ic:baseline-account-balance",
    noun: "ACH transfer",
  },
  wire: {
    label: "Wire",
    icon: "ic:baseline-account-balance",
    noun: "wire transfer",
  },
  iban: {
    label: "IBAN",
    icon: "ic:baseline-account-balance",
    noun: "IBAN transfer",
  },
  bank: {
    label: "Bank transfer",
    icon: "mdi:bank-transfer",
    noun: "bank transfer",
  },
  bank_transfer: {
    label: "Bank transfer",
    icon: "mdi:bank-transfer",
    noun: "bank transfer",
  },

  // Other chains a Cashu mint could bridge to.
  liquid: {
    label: "Liquid",
    icon: "hugeicons:blockchain-01",
    noun: "Liquid address",
  },
  ark: { label: "Ark", icon: "hugeicons:blockchain-01", noun: "Ark address" },
  monero: {
    label: "Monero",
    icon: "simple-icons:monero",
    noun: "Monero address",
  },

  // Cash, for mints fronting a physical counter.
  cash: { label: "Cash", icon: "mdi:cash", noun: "cash payment" },
};

/** Every icon this module can return — the icon registry must contain these. */
export const PAYMENT_METHOD_ICONS: readonly string[] = [
  ...new Set([
    ...Object.values(PRESENTATION).map((entry) => entry.icon),
    UNKNOWN_PAYMENT_METHOD_ICON,
  ]),
];

function normalizeMethod(method: string): string {
  return method.trim().toLowerCase();
}

/**
 * `some_method` / `some-method` → `Some method`. Deliberately plain: a method
 * name the wallet has never seen is shown as the mint wrote it, tidied, rather
 * than guessed at.
 */
function mechanicalLabel(method: string): string {
  const words = normalizeMethod(method).replace(/[_-]+/g, " ").trim();
  if (!words) return method;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function getPaymentMethodPresentation(
  method: MintPaymentMethod,
): PaymentMethodPresentation {
  const key = normalizeMethod(method);
  const known = PRESENTATION[key];
  if (known) return known;
  const label = mechanicalLabel(key);
  return {
    label,
    icon: UNKNOWN_PAYMENT_METHOD_ICON,
    noun: `${label} request`,
  };
}

/** Title-case name for a method ("Venmo", "Lightning", "Bank transfer"). */
export function getPaymentMethodLabel(method: MintPaymentMethod): string {
  return getPaymentMethodPresentation(method).label;
}

/** Iconify name for a method, guaranteed to be in the committed registry. */
export function getPaymentMethodIcon(method: MintPaymentMethod): string {
  return getPaymentMethodPresentation(method).icon;
}

/**
 * Whether this method needs a generic handler because coco has no first-class
 * one. Everything outside bolt11/bolt12/onchain does.
 */
export function isCustomPaymentMethod(method: MintPaymentMethod): boolean {
  return !isBuiltInMintPaymentMethod(normalizeMethod(method));
}
