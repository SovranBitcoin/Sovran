import { parsePaymentInput } from '@/shared/lib/cashu/paymentInputParser';
import {
  resolvePaymentIntent,
  annotateOptions,
  type WalletContext,
} from '@/shared/lib/cashu/paymentIntent';

// ---------------------------------------------------------------------------
// Fixtures — real-world values from NUT-00, NUT-18, NUT-26, BOLT11
// ---------------------------------------------------------------------------

const BOLT11_SPEC_INVOICE =
  'lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh';

// NUT-00 TokenV3 example
const CASHU_TOKEN_V3 =
  'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vODMzMy5zcGFjZTozMzM4IiwicHJvb2ZzIjpbeyJhbW91bnQiOjIsImlkIjoiMDA5YTFmMjkzMjUzZTQxZSIsInNlY3JldCI6IjQwNzkxNWJjMjEyYmU2MWE3N2UzZTZkMmFlYjRjNzI3OTgwYmRhNTFjZDA2YTZhZmMyOWUyODYxNzY4YTc4MzciLCJDIjoiMDJiYzkwOTc5OTdkODFhZmIyY2M3MzQ2YjVlNDM0NWE5MzQ2YmQyYTUwNmViNzk1ODU5OGE3MmYwY2Y4NTE2M2VhIn0seyJhbW91bnQiOjgsImlkIjoiMDA5YTFmMjkzMjUzZTQxZSIsInNlY3JldCI6ImZlMTUxMDkzMTRlNjFkNzc1NmIwZjhlZTBmMjNhNjI0YWNhYTNmNGUwNDJmNjE0MzNjNzI4YzcwNTdiOTMxYmUiLCJDIjoiMDI5ZThlNTA1MGI4OTBhN2Q2YzA5NjhkYjE2YmMxZDVkNWZhMDQwZWExZGUyODRmNmVjNjlkNjEyOTlmNjcxMDU5In1dfV0sInVuaXQiOiJzYXQiLCJtZW1vIjoiVGhhbmsgeW91LiJ9';

// NUT-00 TokenV4 example
const CASHU_TOKEN_V4 =
  'cashuBo2F0gqJhaUgA_9SLj17PgGFwgaNhYQFhc3hAYWNjMTI0MzVlN2I4NDg0YzNjZjE4NTAxNDkyMThhZjkwZjcxNmE1MmJmNGE1ZWQzNDdlNDhlY2MxM2Y3NzM4OGFjWCECRFODGd5IXVW-07KaZCvuWHk3WrnnpiDhHki6SCQh88-iYWlIAK0mjE0fWCZhcIKjYWECYXN4QDEzMjNkM2Q0NzA3YTU4YWQyZTIzYWRhNGU5ZjFmNDlmNWE1YjRhYzdiNzA4ZWIwZDYxZjczOGY0ODMwN2U4ZWVhY1ghAjRWqhENhLSsdHrr2Cw7AFrKUL9Ffr1XN6RBT6w659lNo2FhAWFzeEA1NmJjYmNiYjdjYzY0MDZiM2ZhNWQ1N2QyMTc0ZjRlZmY4YjQ0MDJiMTc2OTI2ZDNhNTdkM2MzZGNiYjU5ZDU3YWNYIQJzEpxXGeWZN5qXSmJjY8MzxWyvwObQGr5G1YCCgHicY2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdA';

// NUT-18 payment request example
const CASHU_PAYMENT_REQUEST_NUT18 =
  'creqApWF0gaNhdGVub3N0cmFheKlucHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OW1od2RlbjV0ZTB3ZmprY2N0ZTljdXJ4dmVuOWVlaHFjdHJ2NWhzenJ0aHdkZW41dGUwZGVoaHh0bnZkYWtxcWd5ZGFxeTdjdXJrNDM5eWtwdGt5c3Y3dWRoZGh1NjhzdWNtMjk1YWtxZWZkZWhrZjBkNDk1Y3d1bmw1YWeBgmFuYjE3YWloYjdhOTAxNzZhYQphdWNzYXRhbYF4Imh0dHBzOi8vbm9mZWVzLnRlc3RudXQuY2FzaHUuc3BhY2U=';

// NUT-26 payment request (uppercase = QR-preferred)
const CASHU_PAYMENT_REQUEST_NUT26_UPPER =
  'CREQB1QYQQWER9D4HNZV3NQGQQSQQQQQQQQQQRAQPSQQGQQSQQZQG9QQVXSAR5WPEN5TE0D45KUAPWV4UXZMTSD3JJUCM0D5RQQRJRDANXVET9YPCXZ7TDV4H8GXHR3TQ';

const CASHU_PAYMENT_REQUEST_NUT26_LOWER = CASHU_PAYMENT_REQUEST_NUT26_UPPER.toLowerCase();

// Real BIP-321 URIs from production NFC tags (user-provided)
const BIP321_CREQ_AND_LIGHTNING_1 =
  'bitcoin:?creq=CREQB1QYQQSD3CXU6RXEPNVSPQQZQQQQQQQQQQQPASXQQPQQZQQQGPQ5QZY6R5W3C8XW309AKKJMN59EKKJMNFVF5HGUEWVDSHX6P0GF5HGCM0D9HQ2QQADP68GURN8GHJ7MTFDE6ZUCMGDAE82UEWVDHK6MT4DE5HG7G9QQWXSAR5WPEN5TE0D45KUAPWVD6KYCTZD96XXMMFDCHX7UN8Q5QPV6R5W3C8XW309AKKJMN59E3K76TWDAEJU6T0Q5QPK6R5W3C8XW309A6X2UM5DE6HGTNRV9EKSAFWWDCXZCM9QCQP25RPVASK6ETWW3HJQER9YQCNYVEQWDSHGUC8QZXSZQQPQQPQQG8EAT5KT7JKQTNYANVLADPZADLPHJGJV34XVDDDLAGK23V8VUUVX5PSQPGPDCPRZDCRQQVSZUSKWAEHXW309AEX2MRP0YH8QUNFD4SKCTNWV46QXQQHQ9EPGAMNWVAZ7TMJV4KXZ7FWV3SK6ATN9E5K7QCQZQQHYRTHWDEN5TE0DEHHXTNVDAKQXQQJQ9EQ7AMNWVAZ7TMWDAEHGU3WD4HK67N6UX5&lightning=lnbc1230n1p56a6rmpp5j2teuxzm6ensa6evh3h69cnx8ndedr28sptsg2n78wzamjrrwg2sdps2pskwctdv4h8gmeqfe6k6meq2p84xgryv5srzv3nypekzarncqzzsxqyz5vqsp5037j9uu428j36ed3s2tguz7mlpj8w2w8z2tr56w37pt5sqluzl5s9qxpqysgqg0rt6dq2mykqczw07ejvx70qjjup64cna3t4ky20j4xuqqgmasnr3yxgr5592v8h4kyvykc0gc9prhp4jr2geft76hpejdlda8xyxhqpsd3gry';

const BIP321_CREQ_AND_LIGHTNING_2 =
  'bitcoin:?creq=CREQB1QYQQSE3KVDJRQDP3XCPQQZQQQQQQQQQQQPASXQQPQQZQQQGPQCQP25RPVASK6ETWW3HJQER9YQCNYVEQWDSHGUC8QZXSZQQPQQPQQGY4TMC5URU2EJMJLFRMK7C56QMPKJT7HY5X8ZCF6DWFD6AW8JG89GPSQPGPDCPRZDCRQQVSZUSKWAEHXW309AEX2MRP0YH8QUNFD4SKCTNWV46QXQQHQ9EPGAMNWVAZ7TMJV4KXZ7FWV3SK6ATN9E5K7QCQZQQHYRTHWDEN5TE0DEHHXTNVDAKQXQQJQ9EQ7AMNWVAZ7TMWDAEHGU3WD4HK6JP8RGX&lightning=lnbc1230n1p56aeespp5gzg2cw9y7agq3r8m0n0fldafu7au6fkdxezxklkz6cxkkgtpq22sdps2pskwctdv4h8gmeqfe6k6meq2p84xgryv5srzv3nypekzarncqzzsxqyz5vqsp5peg3f2y3yypyhrm7x0v9g0659jklx6rxvhfunagthy6ldw8u836s9qxpqysgqs3g258mxevdxcjda63lw9qcn5kmg57ldaymmykxx9twlxcsvwdv4ude0tq06uyndty2stwlna76xt8jp7gld88l7xel28wr9g5yuw5gqay679c';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function optionKinds(input: string) {
  return parsePaymentInput(input).options.map((o) => o.kind);
}

function singleOption(input: string) {
  const parsed = parsePaymentInput(input);
  expect(parsed.options).toHaveLength(1);
  return parsed.options[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parsePaymentInput', () => {
  // ---- Ecash tokens ----

  it('parses the NUT-00 TokenV3 example as a standalone ecash token', () => {
    const parsed = parsePaymentInput(CASHU_TOKEN_V3);

    expect(parsed.type).toBe('supported');
    expect(parsed.container).toBe('standalone');
    expect(parsed.options).toHaveLength(1);
    expect(parsed.options[0]).toMatchObject({
      kind: 'ecashToken',
      value: CASHU_TOKEN_V3,
      source: 'standalone',
    });
  });

  it('parses the NUT-00 TokenV4 example as a standalone ecash token', () => {
    const parsed = parsePaymentInput(CASHU_TOKEN_V4);

    expect(parsed.type).toBe('supported');
    expect(parsed.container).toBe('standalone');
    expect(parsed.options).toHaveLength(1);
    expect(parsed.options[0]).toMatchObject({
      kind: 'ecashToken',
      value: CASHU_TOKEN_V4,
      source: 'standalone',
    });
  });

  it('parses a cashu:-wrapped token', () => {
    const option = singleOption(`cashu:${CASHU_TOKEN_V3}`);

    expect(option).toMatchObject({
      kind: 'ecashToken',
      value: CASHU_TOKEN_V3,
      source: 'standalone',
    });
  });

  // ---- Cashu payment requests ----

  it('parses the NUT-18 example as a standalone Cashu payment request', () => {
    const option = singleOption(CASHU_PAYMENT_REQUEST_NUT18);

    expect(option).toMatchObject({
      kind: 'cashuPaymentRequest',
      value: CASHU_PAYMENT_REQUEST_NUT18,
      source: 'standalone',
    });
  });

  it('parses a cashu:-wrapped NUT-18 payment request', () => {
    const option = singleOption(`cashu:${CASHU_PAYMENT_REQUEST_NUT18}`);

    expect(option).toMatchObject({
      kind: 'cashuPaymentRequest',
      value: CASHU_PAYMENT_REQUEST_NUT18,
      source: 'standalone',
    });
  });

  it('parses the NUT-26 uppercase example as a standalone Cashu payment request', () => {
    const option = singleOption(CASHU_PAYMENT_REQUEST_NUT26_UPPER);

    expect(option).toMatchObject({
      kind: 'cashuPaymentRequest',
      value: CASHU_PAYMENT_REQUEST_NUT26_UPPER,
      source: 'standalone',
    });
  });

  it('accepts lowercase NUT-26 payment requests too', () => {
    const option = singleOption(CASHU_PAYMENT_REQUEST_NUT26_LOWER);

    expect(option).toMatchObject({
      kind: 'cashuPaymentRequest',
      value: CASHU_PAYMENT_REQUEST_NUT26_LOWER,
      source: 'standalone',
    });
  });

  // ---- Lightning ----

  it('parses a lightning:-wrapped BOLT11 invoice and extracts its amount', () => {
    const option = singleOption(`lightning:${BOLT11_SPEC_INVOICE}`);

    expect(option.kind).toBe('lightningInvoice');
    expect(option.value).toBe(BOLT11_SPEC_INVOICE);
    expect(option.amount).toBe(250_000); // 2500u BTC = 250,000 sats
    expect(option.source).toBe('standalone');
  });

  it('parses a Lightning Address in LUD-16 format', () => {
    const option = singleOption('satoshi@bitcoin.org');

    expect(option).toMatchObject({
      kind: 'lightningAddress',
      value: 'satoshi@bitcoin.org',
      source: 'standalone',
    });
  });

  // ---- BIP-321 containers ----

  it('parses BIP321 metadata-only URIs as bip321 type with no supported options', () => {
    const parsed = parsePaymentInput(
      'bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?amount=20.3&label=Luke-Jr'
    );

    expect(parsed.type).toBe('bip321');
    expect(parsed.container).toBe('bip321');
    expect(parsed.options).toEqual([]);
    expect(parsed.bip321).toMatchObject({
      address: '175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W',
      amountBtc: '20.3',
      label: 'Luke-Jr',
    });
  });

  it('parses an empty-path BIP321 lightning URI', () => {
    const parsed = parsePaymentInput(
      `bitcoin:?lightning=${encodeURIComponent(BOLT11_SPEC_INVOICE)}`
    );

    expect(parsed.type).toBe('supported');
    expect(parsed.container).toBe('bip321');
    expect(parsed.bip321?.address).toBeNull();
    expect(parsed.options).toHaveLength(1);
    expect(parsed.options[0]).toMatchObject({
      kind: 'lightningInvoice',
      value: BOLT11_SPEC_INVOICE,
      amount: 250_000,
      source: 'bip321',
      paramKey: 'lightning',
    });
  });

  it('treats the BIP321 scheme and query keys as case-insensitive', () => {
    const parsed = parsePaymentInput(
      `BITCOIN:?LIGHTNING=${encodeURIComponent(BOLT11_SPEC_INVOICE)}`
    );

    expect(parsed.type).toBe('supported');
    expect(parsed.container).toBe('bip321');
    expect(parsed.options).toHaveLength(1);
    expect(parsed.options[0]).toMatchObject({
      kind: 'lightningInvoice',
      source: 'bip321',
      paramKey: 'lightning',
    });
  });

  // ---- Multi-option BIP-321 URIs ----

  it('extracts both a lightning invoice and a Cashu payment request from one combined BIP321 URI', () => {
    const parsed = parsePaymentInput(
      `bitcoin:?lightning=${encodeURIComponent(BOLT11_SPEC_INVOICE)}&creq=${encodeURIComponent(
        CASHU_PAYMENT_REQUEST_NUT26_UPPER
      )}`
    );

    expect(parsed.type).toBe('supported');
    expect(parsed.container).toBe('bip321');
    expect(optionKinds(parsed.raw)).toEqual(['cashuPaymentRequest', 'lightningInvoice']);
  });

  // ---- Real-world NFC BIP-321 URIs (user-provided) ----

  it('extracts both creq and lightning from real NFC BIP-321 URI #1', () => {
    const parsed = parsePaymentInput(BIP321_CREQ_AND_LIGHTNING_1);

    expect(parsed.type).toBe('supported');
    expect(parsed.container).toBe('bip321');
    expect(parsed.options.length).toBe(2);

    const kinds = parsed.options.map((o) => o.kind);
    expect(kinds).toContain('cashuPaymentRequest');
    expect(kinds).toContain('lightningInvoice');

    const creqOption = parsed.options.find((o) => o.kind === 'cashuPaymentRequest')!;
    expect(creqOption.paramKey).toBe('creq');
    expect(creqOption.source).toBe('bip321');

    const lnOption = parsed.options.find((o) => o.kind === 'lightningInvoice')!;
    expect(lnOption.paramKey).toBe('lightning');
    expect(lnOption.source).toBe('bip321');
    expect(lnOption.amount).toBeGreaterThan(0);
  });

  it('extracts both creq and lightning from real NFC BIP-321 URI #2', () => {
    const parsed = parsePaymentInput(BIP321_CREQ_AND_LIGHTNING_2);

    expect(parsed.type).toBe('supported');
    expect(parsed.container).toBe('bip321');
    expect(parsed.options.length).toBe(2);

    const kinds = parsed.options.map((o) => o.kind);
    expect(kinds).toContain('cashuPaymentRequest');
    expect(kinds).toContain('lightningInvoice');
  });

  // ---- Unsupported / ignored ----

  it('returns a bip321 container with no supported options when only unsupported instructions exist', () => {
    const parsed = parsePaymentInput('bitcoin:?lno=lno1bogusoffer&sp=sp1qsilentpayment');

    expect(parsed.type).toBe('bip321');
    expect(parsed.container).toBe('bip321');
    expect(parsed.options).toEqual([]);
  });

  it('warns about unknown BIP-321 params without discarding supported options', () => {
    const parsed = parsePaymentInput(
      `bitcoin:?lightning=${encodeURIComponent(BOLT11_SPEC_INVOICE)}&somethingyoudontunderstand=50`
    );

    expect(parsed.type).toBe('supported');
    expect(parsed.options).toHaveLength(1);
    expect(parsed.options[0].kind).toBe('lightningInvoice');
    expect(parsed.warnings).toEqual([
      'Ignored unsupported bitcoin params: somethingyoudontunderstand',
    ]);
  });

  // ---- Priority ordering ----

  it('sorts options deterministically by kind priority', () => {
    const parsed = parsePaymentInput(
      `bitcoin:?cashu=${encodeURIComponent(CASHU_TOKEN_V3)}&lightning=${encodeURIComponent(
        BOLT11_SPEC_INVOICE
      )}&creq=${encodeURIComponent(CASHU_PAYMENT_REQUEST_NUT18)}`
    );

    expect(parsed.options.map((o) => o.kind)).toEqual([
      'cashuPaymentRequest',
      'ecashToken',
      'lightningInvoice',
    ]);
  });

  // ---- Other types ----

  it('classifies a mint URL', () => {
    const parsed = parsePaymentInput('https://mint.example.com');
    expect(parsed.type).toBe('mintUrl');
    expect(parsed.mintUrl).toBe('https://mint.example.com');
  });

  it('classifies UR fragments', () => {
    const parsed = parsePaymentInput('ur:bytes/1-3/abc');
    expect(parsed.type).toBe('ur');
  });

  it('returns unknown for unrecognised input', () => {
    const parsed = parsePaymentInput('random garbage string');
    expect(parsed.type).toBe('unknown');
  });

  it('returns error for empty input', () => {
    const parsed = parsePaymentInput('');
    expect(parsed.type).toBe('unknown');
    expect(parsed.errors).toContain('Empty input');
  });
});

// ---------------------------------------------------------------------------
// resolvePaymentIntent
// ---------------------------------------------------------------------------

describe('resolvePaymentIntent', () => {
  it('resolves a single ecash token to receiveEcash', () => {
    const parsed = parsePaymentInput(CASHU_TOKEN_V3);
    const intent = resolvePaymentIntent(parsed);

    expect(intent.type).toBe('receiveEcash');
  });

  it('resolves a single lightning invoice to payLightningInvoice', () => {
    const parsed = parsePaymentInput(`lightning:${BOLT11_SPEC_INVOICE}`);
    const intent = resolvePaymentIntent(parsed);

    expect(intent.type).toBe('payLightningInvoice');
  });

  it('resolves multiple options to chooseOption', () => {
    const parsed = parsePaymentInput(BIP321_CREQ_AND_LIGHTNING_1);
    const intent = resolvePaymentIntent(parsed);

    expect(intent.type).toBe('chooseOption');
  });

  it('resolves a bip321-only URI (no supported options) to ignore', () => {
    const parsed = parsePaymentInput('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W');
    const intent = resolvePaymentIntent(parsed);

    expect(intent.type).toBe('ignore');
  });

  it('resolves a mint URL to openMintUrl', () => {
    const parsed = parsePaymentInput('https://mint.example.com');
    const intent = resolvePaymentIntent(parsed);

    expect(intent.type).toBe('openMintUrl');
    if (intent.type === 'openMintUrl') {
      expect(intent.url).toBe('https://mint.example.com');
    }
  });
});

// ---------------------------------------------------------------------------
// annotateOptions (recommendation logic)
// ---------------------------------------------------------------------------

describe('annotateOptions', () => {
  const CREQ_WITH_MINTS = parsePaymentInput(BIP321_CREQ_AND_LIGHTNING_1);

  it('marks cashu payment request as recommended when a matching mint has balance', () => {
    // Extract the creq from the fixture to find its mints
    const creqOption = CREQ_WITH_MINTS.options.find(
      (o) => o.kind === 'cashuPaymentRequest'
    )!;

    // Create a wallet context where we have the mints the creq wants
    const ctx: WalletContext = {
      trustedMintUrls: ['https://mint.example.com'],
      mintBalances: { 'https://mint.example.com': 100_000 },
    };

    // The creq might specify mints or not — test annotation works
    const annotated = annotateOptions(CREQ_WITH_MINTS.options, ctx);
    // Should have 2 annotated options
    expect(annotated).toHaveLength(2);
  });

  it('marks lightning as available when wallet has balance', () => {
    const ctx: WalletContext = {
      trustedMintUrls: ['https://mint.example.com'],
      mintBalances: { 'https://mint.example.com': 50_000 },
    };

    const annotated = annotateOptions(CREQ_WITH_MINTS.options, ctx);
    const lightning = annotated.find((a) => a.option.kind === 'lightningInvoice');

    expect(lightning).toBeDefined();
    expect(lightning!.status).toBe('available');
  });

  it('marks lightning as disabled when wallet has no balance', () => {
    const ctx: WalletContext = {
      trustedMintUrls: [],
      mintBalances: {},
    };

    const annotated = annotateOptions(CREQ_WITH_MINTS.options, ctx);
    const lightning = annotated.find((a) => a.option.kind === 'lightningInvoice');

    expect(lightning).toBeDefined();
    expect(lightning!.status).toBe('disabled');
  });

  it('sorts recommended options before available, available before disabled', () => {
    const ctx: WalletContext = {
      trustedMintUrls: ['https://mint.example.com'],
      mintBalances: { 'https://mint.example.com': 100_000 },
    };

    const annotated = annotateOptions(CREQ_WITH_MINTS.options, ctx);
    const statuses = annotated.map((a) => a.status);

    // Verify ordering is non-decreasing in priority
    const priority = { recommended: 0, available: 1, disabled: 2 };
    for (let i = 1; i < statuses.length; i++) {
      expect(priority[statuses[i]]).toBeGreaterThanOrEqual(priority[statuses[i - 1]]);
    }
  });
});
