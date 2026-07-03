// ---------------------------------------------------------------------------
// Locales — translation dictionaries for user-facing reason codes and messages
//
// The library uses locale codes (e.g. 'en', 'ar', 'de') to resolve
// human-readable messages. The locale is read from the provider via
// `getLocale()`. Falls back to 'en' when a locale or key is missing.
// ---------------------------------------------------------------------------

import { logger } from '../logger';

export interface LocalizedReason {
  code: string;
  message: string;
  /**
   * Structured values interpolated into `message` (e.g. `{min}`), kept so
   * consumers can aggregate reasons numerically (e.g. pick the smallest
   * advertised minimum across mints) without re-parsing the message.
   */
  params?: Record<string, string | number>;
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
  MINT_UNREACHABLE: 'Mint unreachable',
  NO_WEBSOCKET: 'Does not support live updates (NUT-17)',
  MINT_METHOD_DISABLED: 'Payment method disabled by mint',
  MINT_METHOD_UNSUPPORTED: 'Mint does not support this payment method',
  PAYMENT_METHOD_NOT_IMPLEMENTED: 'Payment method is not supported yet',
  AMOUNT_BELOW_MINT_MIN: 'Minimum {min} {unit}',
  AMOUNT_ABOVE_MINT_MAX: 'Maximum {max} {unit}',

  // ExecutionState messages
  OPTION_SELECTION_REQUIRED: 'Option selection is required to continue',
  FALLBACK_OPTION_REQUIRED: 'Choose an alternative payment method',
  NO_AMOUNT: 'Amount is required to continue',
  MINT_SELECTION_REQUIRED: 'Mint selection is required to continue',
  PROOF_SELECTION_REQUIRED: 'Proof selection is required to continue',
  SEND_MEMO_REQUIRED: 'Memo input is required to continue',

  // Blocked / error messages
  NO_VALID_MINT: 'No valid mint available',
  ALL_OPTIONS_DISABLED: 'All payment options are disabled',
  UNSUPPORTED_INPUT: 'Unsupported input',
  SEND_FAILED: 'Failed to create token',
  MINT_QUOTE_FAILED: 'Failed to create mint quote',
  MELT_FAILED: 'Lightning payment failed',
  PAYMENT_REQUEST_FAILED: 'Payment request failed',
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
  MINT_UNREACHABLE: 'المنت غير متاح',
  NO_WEBSOCKET: 'لا يدعم التحديثات الفورية (NUT-17)',
  MINT_METHOD_DISABLED: 'طريقة الدفع معطلة من المنت',
  MINT_METHOD_UNSUPPORTED: 'المنت لا يدعم طريقة الدفع هذه',
  PAYMENT_METHOD_NOT_IMPLEMENTED: 'طريقة الدفع غير مدعومة بعد',
  AMOUNT_BELOW_MINT_MIN: 'الحد الأدنى {min} {unit}',
  AMOUNT_ABOVE_MINT_MAX: 'الحد الأقصى {max} {unit}',

  OPTION_SELECTION_REQUIRED: 'يجب اختيار خيار للمتابعة',
  FALLBACK_OPTION_REQUIRED: 'اختر طريقة دفع بديلة',
  NO_AMOUNT: 'يجب إدخال المبلغ للمتابعة',
  MINT_SELECTION_REQUIRED: 'يجب اختيار المنت للمتابعة',
  PROOF_SELECTION_REQUIRED: 'يجب اختيار الإثبات للمتابعة',
  SEND_MEMO_REQUIRED: 'يجب إدخال المذكرة أو تخطيها للمتابعة',

  NO_VALID_MINT: 'لا يوجد منت صالح',
  ALL_OPTIONS_DISABLED: 'جميع خيارات الدفع معطلة',
  UNSUPPORTED_INPUT: 'إدخال غير مدعوم',
  SEND_FAILED: 'فشل إنشاء التوكن',
  MINT_QUOTE_FAILED: 'فشل إنشاء عرض السعر',
  MELT_FAILED: 'فشل الدفع عبر البرق',
  PAYMENT_REQUEST_FAILED: 'فشل طلب الدفع',
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
  MINT_UNREACHABLE: 'Mint nicht erreichbar',
  NO_WEBSOCKET: 'Unterstützt keine Live-Updates (NUT-17)',
  MINT_METHOD_DISABLED: 'Zahlungsmethode ist vom Mint deaktiviert',
  MINT_METHOD_UNSUPPORTED: 'Mint unterstützt diese Zahlungsmethode nicht',
  PAYMENT_METHOD_NOT_IMPLEMENTED: 'Zahlungsmethode wird noch nicht unterstützt',
  AMOUNT_BELOW_MINT_MIN: 'Mindestens {min} {unit}',
  AMOUNT_ABOVE_MINT_MAX: 'Höchstens {max} {unit}',

  OPTION_SELECTION_REQUIRED: 'Option muss ausgewählt werden',
  FALLBACK_OPTION_REQUIRED: 'Wählen Sie eine alternative Zahlungsmethode',
  NO_AMOUNT: 'Betrag muss eingegeben werden',
  MINT_SELECTION_REQUIRED: 'Mint muss ausgewählt werden',
  PROOF_SELECTION_REQUIRED: 'Proof muss ausgewählt werden',
  SEND_MEMO_REQUIRED: 'Memo muss eingegeben oder übersprungen werden',

  NO_VALID_MINT: 'Kein gültiger Mint verfügbar',
  ALL_OPTIONS_DISABLED: 'Alle Zahlungsoptionen sind deaktiviert',
  UNSUPPORTED_INPUT: 'Nicht unterstützte Eingabe',
  SEND_FAILED: 'Token konnte nicht erstellt werden',
  MINT_QUOTE_FAILED: 'Mint-Angebot konnte nicht erstellt werden',
  MELT_FAILED: 'Lightning-Zahlung fehlgeschlagen',
  PAYMENT_REQUEST_FAILED: 'Zahlungsanfrage fehlgeschlagen',
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
export function registerLocale(
  lang: string,
  translations: TranslationMap,
): void {
  logger.info('formatting.locale.register', {
    lang,
    translationCount: Object.keys(translations).length,
    existingTranslationCount: Object.keys(locales[lang] ?? {}).length,
  });
  locales[lang] = { ...(locales[lang] ?? {}), ...translations };
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

function resolveLocale(locale: string): TranslationMap {
  const exact = locales[locale];
  if (exact) return exact;

  const lang = locale.split('-')[0].toLowerCase();
  const fallback = locales[lang] ?? en;
  logger.debug('formatting.locale.resolveFallback', {
    locale,
    lang,
    fallback: locales[lang] ? 'language' : 'en',
  });
  return fallback;
}

function interpolate(
  template: string,
  locale: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    if (value === undefined) return match;
    return typeof value === 'number' ? value.toLocaleString(locale) : value;
  });
}

/**
 * Translate a reason code to a localized message.
 * Falls back to English, then to the code itself.
 * `params` values replace `{key}` placeholders in the message.
 */
export function t(
  code: string,
  locale: string = 'en',
  params?: Record<string, string | number>,
): string {
  const dict = resolveLocale(locale);
  const localized = dict[code];
  if (localized !== undefined) return interpolate(localized, locale, params);
  const english = en[code];
  if (english !== undefined) {
    logger.debug('formatting.locale.translationFallback', {
      code,
      locale,
      fallback: 'en',
    });
    return interpolate(english, locale, params);
  }
  logger.warn('formatting.locale.translationMissing', { code, locale });
  return code;
}

/**
 * Build a `LocalizedReason` from a code and locale.
 * Returns `null` when the code is null/undefined.
 */
export function localizeReason(
  code: string | null | undefined,
  locale: string = 'en',
  params?: Record<string, string | number>,
): LocalizedReason | null {
  if (code == null) {
    logger.debug('formatting.locale.reasonSkipped', { locale });
    return null;
  }
  return {
    code,
    message: t(code, locale, params),
    ...(params ? { params } : {}),
  };
}
