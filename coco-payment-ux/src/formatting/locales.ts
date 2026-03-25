// ---------------------------------------------------------------------------
// Locales — translation dictionaries for user-facing reason codes and messages
//
// The library uses locale codes (e.g. 'en', 'ar', 'de') to resolve
// human-readable messages. The locale is read from the provider via
// `getLocale()`. Falls back to 'en' when a locale or key is missing.
// ---------------------------------------------------------------------------

export interface LocalizedReason {
  code: string;
  message: string;
}

type TranslationMap = Record<string, string>;

// ---------------------------------------------------------------------------
// Translation dictionaries
// ---------------------------------------------------------------------------

const en: TranslationMap = {
  // Annotation reasons
  PAYABLE_ECASH: 'Payable with Cashu — no fees',

  // Mint availability reasons
  INSUFFICIENT_BALANCE: 'Insufficient balance',
  NO_BALANCE: 'No balance',
  NOT_IN_PAYMENT_REQUEST: 'Not in payment request',
  UNSUPPORTED_FOR_FLOW: 'Unsupported for this flow',

  // ExecutionState messages
  OPTION_SELECTION_REQUIRED: 'Option selection is required to continue',
  NO_AMOUNT: 'Amount is required to continue',
  MINT_SELECTION_REQUIRED: 'Mint selection is required to continue',
  PROOF_SELECTION_REQUIRED: 'Proof selection is required to continue',

  // Blocked / error messages
  NO_VALID_MINT: 'No valid mint available',
  ALL_OPTIONS_DISABLED: 'All payment options are disabled',
  UNSUPPORTED_INPUT: 'Unsupported input',
  SEND_FAILED: 'Failed to create token',
  MINT_QUOTE_FAILED: 'Failed to create mint quote',
  LOAD_MINTS_FAILED: 'Failed to load mints',
  TRUST_MINT_FAILED: 'Failed to trust mint',

  // Mint selection errors
  NO_ALLOWED_MINT_TRUSTED: 'No allowed mint is trusted',
  INSUFFICIENT_BALANCE_ALLOWED: 'Insufficient balance on allowed mints',
  NO_MINT_SUFFICIENT_BALANCE: 'No mint with sufficient balance',
};

const ar: TranslationMap = {
  PAYABLE_ECASH: 'يمكن الدفع بكاشو — بدون رسوم',

  INSUFFICIENT_BALANCE: 'رصيد غير كافٍ',
  NO_BALANCE: 'لا يوجد رصيد',
  NOT_IN_PAYMENT_REQUEST: 'غير مدرج في طلب الدفع',
  UNSUPPORTED_FOR_FLOW: 'غير مدعوم لهذا التدفق',

  OPTION_SELECTION_REQUIRED: 'يجب اختيار خيار للمتابعة',
  NO_AMOUNT: 'يجب إدخال المبلغ للمتابعة',
  MINT_SELECTION_REQUIRED: 'يجب اختيار المنت للمتابعة',
  PROOF_SELECTION_REQUIRED: 'يجب اختيار الإثبات للمتابعة',

  NO_VALID_MINT: 'لا يوجد منت صالح',
  ALL_OPTIONS_DISABLED: 'جميع خيارات الدفع معطلة',
  UNSUPPORTED_INPUT: 'إدخال غير مدعوم',
  SEND_FAILED: 'فشل إنشاء التوكن',
  MINT_QUOTE_FAILED: 'فشل إنشاء عرض السعر',
  LOAD_MINTS_FAILED: 'فشل تحميل المنتات',
  TRUST_MINT_FAILED: 'فشل الوثوق بالمنت',

  NO_ALLOWED_MINT_TRUSTED: 'لا يوجد منت مسموح به موثوق',
  INSUFFICIENT_BALANCE_ALLOWED: 'رصيد غير كافٍ في المنتات المسموحة',
  NO_MINT_SUFFICIENT_BALANCE: 'لا يوجد منت برصيد كافٍ',
};

const de: TranslationMap = {
  PAYABLE_ECASH: 'Zahlbar mit Cashu — keine Gebühren',

  INSUFFICIENT_BALANCE: 'Unzureichendes Guthaben',
  NO_BALANCE: 'Kein Guthaben',
  NOT_IN_PAYMENT_REQUEST: 'Nicht in Zahlungsanfrage enthalten',
  UNSUPPORTED_FOR_FLOW: 'Für diesen Ablauf nicht unterstützt',

  OPTION_SELECTION_REQUIRED: 'Option muss ausgewählt werden',
  NO_AMOUNT: 'Betrag muss eingegeben werden',
  MINT_SELECTION_REQUIRED: 'Mint muss ausgewählt werden',
  PROOF_SELECTION_REQUIRED: 'Proof muss ausgewählt werden',

  NO_VALID_MINT: 'Kein gültiger Mint verfügbar',
  ALL_OPTIONS_DISABLED: 'Alle Zahlungsoptionen sind deaktiviert',
  UNSUPPORTED_INPUT: 'Nicht unterstützte Eingabe',
  SEND_FAILED: 'Token konnte nicht erstellt werden',
  MINT_QUOTE_FAILED: 'Mint-Angebot konnte nicht erstellt werden',
  LOAD_MINTS_FAILED: 'Mints konnten nicht geladen werden',
  TRUST_MINT_FAILED: 'Mint konnte nicht vertraut werden',

  NO_ALLOWED_MINT_TRUSTED: 'Kein erlaubter Mint ist vertraut',
  INSUFFICIENT_BALANCE_ALLOWED: 'Unzureichendes Guthaben bei erlaubten Mints',
  NO_MINT_SUFFICIENT_BALANCE: 'Kein Mint mit ausreichendem Guthaben',
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const locales: Record<string, TranslationMap> = { en, ar, de };

/**
 * Register additional locale translations at runtime.
 *
 * @example
 * registerLocale('fr', {
 *   INSUFFICIENT_BALANCE: 'Solde insuffisant',
 *   NO_BALANCE: 'Pas de solde',
 *   // ...
 * });
 */
export function registerLocale(lang: string, translations: TranslationMap): void {
  locales[lang] = { ...(locales[lang] ?? {}), ...translations };
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

function resolveLocale(locale: string): TranslationMap {
  const exact = locales[locale];
  if (exact) return exact;

  const lang = locale.split('-')[0].toLowerCase();
  return locales[lang] ?? en;
}

/**
 * Translate a reason code to a localized message.
 * Falls back to English, then to the code itself.
 */
export function t(code: string, locale: string = 'en'): string {
  const dict = resolveLocale(locale);
  return dict[code] ?? en[code] ?? code;
}

/**
 * Build a `LocalizedReason` from a code and locale.
 * Returns `null` when the code is null/undefined.
 */
export function localizeReason(
  code: string | null | undefined,
  locale: string = 'en'
): LocalizedReason | null {
  if (code == null) return null;
  return { code, message: t(code, locale) };
}
