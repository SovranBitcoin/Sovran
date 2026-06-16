import { err, ok } from "neverthrow";

import { logger } from "../logger";
import { paymentCopyDefaults } from "./defaults";
import type {
  PaymentCopyCatalog,
  PaymentCopyError,
  PaymentCopyKey,
  PaymentCopyOptions,
  PaymentCopyResolver,
  PaymentCopyResult,
  PaymentCopyVariables,
} from "./types";

const VARIABLE_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;
const catalogs: Record<string, Partial<PaymentCopyCatalog>> = {
  en: paymentCopyDefaults,
};

function normalizeLocale(locale: string | undefined): string {
  return locale?.trim() || "en";
}

function resolveLocaleCatalog(
  locale: string | undefined,
): Partial<PaymentCopyCatalog> {
  const normalized = normalizeLocale(locale);
  const exact = catalogs[normalized];
  if (exact) return exact;
  const language = normalized.split("-")[0].toLowerCase();
  const languageCatalog = catalogs[language];
  if (languageCatalog) {
    logger.debug("copy.locale.fallback", {
      locale: normalized,
      fallbackLocale: language,
    });
    return languageCatalog;
  }
  if (normalized !== "en") {
    logger.debug("copy.locale.fallback", {
      locale: normalized,
      fallbackLocale: "en",
    });
  }
  return paymentCopyDefaults;
}

function isPaymentCopyKey(key: string): key is PaymentCopyKey {
  return Object.prototype.hasOwnProperty.call(paymentCopyDefaults, key);
}

function templateForKey(
  key: PaymentCopyKey,
  options: PaymentCopyOptions,
): string | null {
  const override = options.overrides?.[key];
  if (override !== undefined) return override;
  return (
    resolveLocaleCatalog(options.locale)[key] ??
    paymentCopyDefaults[key] ??
    null
  );
}

function interpolatePaymentCopy(
  key: PaymentCopyKey,
  template: string,
  variables: PaymentCopyVariables,
): PaymentCopyResult {
  let missingVariable: PaymentCopyError | null = null;
  const text = template.replace(
    VARIABLE_PATTERN,
    (_match, variable: string) => {
      const value = variables[variable];
      if (value == null) {
        missingVariable = { type: "missing-variable", key, variable };
        logger.warn("copy.resolve.missingVariable", { key, variable });
        return "";
      }
      return String(value);
    },
  );
  return missingVariable ? err(missingVariable) : ok(text);
}

export function registerPaymentCopyLocale(
  locale: string,
  translations: Record<string, string>,
): void {
  const knownTranslations: Partial<PaymentCopyCatalog> = {};
  let ignoredCount = 0;
  for (const [key, value] of Object.entries(translations)) {
    if (isPaymentCopyKey(key)) {
      knownTranslations[key] = value;
    } else {
      ignoredCount += 1;
    }
  }
  catalogs[locale] = { ...(catalogs[locale] ?? {}), ...knownTranslations };
  logger.info("copy.locale.register", {
    locale: normalizeLocale(locale),
    acceptedCount: Object.keys(knownTranslations).length,
    ignoredCount,
    totalCount: Object.keys(translations).length,
  });
}

export function resolvePaymentCopy(
  key: PaymentCopyKey,
  variables: PaymentCopyVariables = {},
  options: PaymentCopyOptions = {},
): PaymentCopyResult {
  const template = templateForKey(key, options);
  if (template == null) {
    logger.warn("copy.resolve.missingKey", {
      key,
      locale: options.locale ?? null,
      hasOverrides: !!options.overrides,
    });
    return err({ type: "missing-key", key });
  }
  return interpolatePaymentCopy(key, template, variables);
}

export function getPaymentCopy(
  key: PaymentCopyKey,
  variables: PaymentCopyVariables = {},
  options: PaymentCopyOptions = {},
): string {
  const resolved = resolvePaymentCopy(key, variables, options);
  if (resolved.isOk()) return resolved.value;
  logger.warn("copy.get.fallback", {
    key,
    reason: resolved.error.type,
    locale: options.locale ?? null,
  });
  return paymentCopyDefaults[key];
}

export function createPaymentCopyResolver(
  options: PaymentCopyOptions = {},
): PaymentCopyResolver {
  logger.debug("copy.resolver.create", {
    locale: options.locale ?? null,
    overrideCount: options.overrides
      ? Object.keys(options.overrides).length
      : 0,
  });
  return {
    text: (key, variables) => getPaymentCopy(key, variables, options),
    resolve: (key, variables) => resolvePaymentCopy(key, variables, options),
  };
}
