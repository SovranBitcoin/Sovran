# Localization

Every user-facing string returned from `colada` is localized. Reason codes, error messages, and execution state messages are all translated based on the locale configured on the [provider](/guide/getting-started#provider).

## Setup

Set [`runtime.getLocale`](/guide/getting-started#provider) on the provider. The library reads it whenever it builds a user-facing message:

```ts
<ColadaProvider
  runtime={{
    getLocale: () => i18n.language,
  }}
  // ... other props
>
```

When `runtime.getLocale` is not provided, all messages default to `'en'`.

The locale also flows to [formatting](/methods/formatting#locale) — [`FormattedTimestamp`](/methods/formatting#formattedtimestamp) dates and [`FormattedString`](/methods/formatting#formattedstring) RTL truncation both use the same locale.

## LocalizedReason

Every `reason` field in the library uses the [`LocalizedReason`](#localizedreason) shape instead of a raw string code:

```ts
interface LocalizedReason {
  code: string;
  message: string;
}
```

`code` is the stable identifier for programmatic use. `message` is the translated string for display:

```ts
{
  code: 'INSUFFICIENT_BALANCE',
  message: 'Insufficient balance',       // en
}

{
  code: 'INSUFFICIENT_BALANCE',
  message: 'رصيد غير كافٍ',              // ar
}

{
  code: 'INSUFFICIENT_BALANCE',
  message: 'Unzureichendes Guthaben',    // de
}
```

This appears on [`MintListItem.reason`](/flows/cashu-send#handler-selectmint), [`MintAvailability.reason`](/flows/cashu-send#handler-selectmint), and [`ExecutionState`](/guide/architecture#execution-state) messages.

### Using reason in UI

The wallet displays `reason.message` directly — no switch/case or lookup needed:

```tsx
<Text style={{ opacity: 0.5 }}>{item.reason?.message}</Text>
```

To branch on the code programmatically (e.g., showing different icons):

```tsx
{
  item.reason?.code === 'NOT_IN_PAYMENT_REQUEST' && <LockIcon />;
}
{
  item.reason?.code === 'INSUFFICIENT_BALANCE' && <WarningIcon />;
}
```

## Supported languages

The library ships with three built-in locales:

| Code   | Language |
| ------ | -------- |
| `'en'` | English  |
| `'ar'` | Arabic   |
| `'de'` | German   |

Locale resolution is lenient — `'de-AT'` resolves to `'de'`, `'ar-EG'` resolves to `'ar'`. Unknown locales fall back to `'en'`.

## Translation keys

All translated strings and their values across the built-in locales:

### Mint availability

| Code                     | English                   | Arabic                | German                              |
| ------------------------ | ------------------------- | --------------------- | ----------------------------------- |
| `INSUFFICIENT_BALANCE`   | Insufficient balance      | رصيد غير كافٍ         | Unzureichendes Guthaben             |
| `NO_BALANCE`             | No balance                | لا يوجد رصيد          | Kein Guthaben                       |
| `NOT_IN_PAYMENT_REQUEST` | Not in payment request    | غير مدرج في طلب الدفع | Nicht in Zahlungsanfrage enthalten  |
| `UNSUPPORTED_FOR_FLOW`   | Unsupported for this flow | غير مدعوم لهذا التدفق | Für diesen Ablauf nicht unterstützt |

### Execution state

| Code                        | English                                  | Arabic                      | German                        |
| --------------------------- | ---------------------------------------- | --------------------------- | ----------------------------- |
| `OPTION_SELECTION_REQUIRED` | Option selection is required to continue | يجب اختيار خيار للمتابعة    | Option muss ausgewählt werden |
| `NO_AMOUNT`                 | Amount is required to continue           | يجب إدخال المبلغ للمتابعة   | Betrag muss eingegeben werden |
| `MINT_SELECTION_REQUIRED`   | Mint selection is required to continue   | يجب اختيار المنت للمتابعة   | Mint muss ausgewählt werden   |
| `PROOF_SELECTION_REQUIRED`  | Proof selection is required to continue  | يجب اختيار الإثبات للمتابعة | Proof muss ausgewählt werden  |

### Errors

| Code                   | English                          | Arabic                  | German                                    |
| ---------------------- | -------------------------------- | ----------------------- | ----------------------------------------- |
| `NO_VALID_MINT`        | No valid mint available          | لا يوجد منت صالح        | Kein gültiger Mint verfügbar              |
| `ALL_OPTIONS_DISABLED` | All payment options are disabled | جميع خيارات الدفع معطلة | Alle Zahlungsoptionen sind deaktiviert    |
| `UNSUPPORTED_INPUT`    | Unsupported input                | إدخال غير مدعوم         | Nicht unterstützte Eingabe                |
| `SEND_FAILED`          | Failed to create token           | فشل إنشاء التوكن        | Token konnte nicht erstellt werden        |
| `MINT_QUOTE_FAILED`    | Failed to create mint quote      | فشل إنشاء عرض السعر     | Mint-Angebot konnte nicht erstellt werden |
| `LOAD_MINTS_FAILED`    | Failed to load mints             | فشل تحميل المنتات       | Mints konnten nicht geladen werden        |

### Mint selection

| Code                           | English                               | Arabic                            | German                                      |
| ------------------------------ | ------------------------------------- | --------------------------------- | ------------------------------------------- |
| `NO_ALLOWED_MINT_TRUSTED`      | No allowed mint is trusted            | لا يوجد منت مسموح به موثوق        | Kein erlaubter Mint ist vertraut            |
| `INSUFFICIENT_BALANCE_ALLOWED` | Insufficient balance on allowed mints | رصيد غير كافٍ في المنتات المسموحة | Unzureichendes Guthaben bei erlaubten Mints |
| `NO_MINT_SUFFICIENT_BALANCE`   | No mint with sufficient balance       | لا يوجد منت برصيد كافٍ            | Kein Mint mit ausreichendem Guthaben        |

## Adding a language

Pass [`runtime.translations`](/guide/getting-started#provider) on the provider with your custom locale dictionaries:

```tsx
<ColadaProvider
  runtime={{
    getLocale: () => i18n.language,
    translations: {
      fr: {
        INSUFFICIENT_BALANCE: 'Solde insuffisant',
        NO_BALANCE: 'Pas de solde',
        NOT_IN_PAYMENT_REQUEST: 'Pas dans la demande de paiement',
        UNSUPPORTED_FOR_FLOW: 'Non pris en charge pour ce flux',
        OPTION_SELECTION_REQUIRED: 'Une option doit être sélectionnée',
        NO_AMOUNT: 'Le montant est requis',
        MINT_SELECTION_REQUIRED: 'Un mint doit être sélectionné',
        PROOF_SELECTION_REQUIRED: 'Une preuve doit être sélectionnée',
        NO_VALID_MINT: 'Aucun mint valide disponible',
        ALL_OPTIONS_DISABLED: 'Toutes les options de paiement sont désactivées',
        UNSUPPORTED_INPUT: 'Entrée non prise en charge',
        SEND_FAILED: 'Échec de la création du jeton',
        MINT_QUOTE_FAILED: 'Échec de la création du devis',
        LOAD_MINTS_FAILED: 'Échec du chargement des mints',
        NO_ALLOWED_MINT_TRUSTED: "Aucun mint autorisé n'est de confiance",
        INSUFFICIENT_BALANCE_ALLOWED: 'Solde insuffisant sur les mints autorisés',
        NO_MINT_SUFFICIENT_BALANCE: 'Aucun mint avec un solde suffisant',
      },
    },
  }}
>
```

Partial translations work — missing keys fall back to English:

```tsx
runtime={{
  translations: {
    fr: {
      INSUFFICIENT_BALANCE: 'Solde insuffisant',
      NO_BALANCE: 'Pas de solde',
    },
  },
}}
```

You can also override built-in locales the same way:

```tsx
runtime={{
  translations: {
    en: {
      INSUFFICIENT_BALANCE: 'Not enough funds',
    },
  },
}}
```
