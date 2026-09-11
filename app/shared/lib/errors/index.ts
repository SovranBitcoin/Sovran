import { CASHU_CODES, CASHU_MESSAGE_RULES, ERROR_COPY, type ErrorId } from './catalog';
import { inspectError } from './inspect';

export type ErrorService = 'routstr' | 'cashu' | 'nostr' | 'nagg' | 'app';

export interface ServiceFailure {
  service: ErrorService;
  error: unknown;
}

interface ErrorPresentation {
  id: ErrorId;
  text: string;
}

type TypeRules = readonly (readonly [string, ErrorId])[];
const SOURCE_TYPES: Partial<Record<ErrorService, TypeRules>> = {
  nostr: [
    ['no-signer', 'nostr.no_signer'],
    ['sign-failed', 'nostr.sign_failed'],
    ['no-relays', 'nostr.no_relays'],
    ['all-failed', 'nostr.all_failed'],
  ],
  nagg: [
    ['endpoint_required', 'nagg.not_configured'],
    ['schema', 'nagg.invalid_response'],
    ['missing_data', 'nagg.invalid_response'],
    ['graphql', 'nagg.unknown'],
  ],
};
const CASHU_TYPES: TypeRules = [
  ['OperationInProgressError', 'cashu.operation_pending'],
  ['AuthSessionExpiredError', 'cashu.auth'],
  ['AuthSessionError', 'cashu.auth'],
  ['TokenValidationError', 'cashu.invalid_token'],
  ['HttpResponseError', 'cashu.unavailable'],
];
const COMMON_HTTP: Readonly<Partial<Record<number, ErrorId>>> = {
  401: 'auth',
  403: 'forbidden',
  408: 'timeout',
  429: 'rate_limited',
  504: 'timeout',
};
const SOURCE_HTTP: Partial<Record<ErrorService, Readonly<Partial<Record<number, ErrorId>>>>> = {
  routstr: {
    400: 'routstr.invalid_request',
    401: 'routstr.auth',
    402: 'routstr.balance',
    404: 'routstr.not_found',
    408: 'routstr.timeout',
    504: 'routstr.timeout',
  },
  cashu: { 401: 'cashu.auth', 408: 'cashu.timeout', 504: 'cashu.timeout' },
  nagg: { 404: 'nagg.not_found' },
};
const TRANSPORT_COPY: Record<
  ErrorService,
  { network: ErrorId; timeout: ErrorId; cancelled: ErrorId; unavailable: ErrorId }
> = {
  cashu: {
    network: 'cashu.network',
    timeout: 'cashu.timeout',
    cancelled: 'cashu.cancelled',
    unavailable: 'cashu.unavailable',
  },
  routstr: {
    network: 'network',
    timeout: 'routstr.timeout',
    cancelled: 'cancelled',
    unavailable: 'routstr.unavailable',
  },
  nagg: {
    network: 'network',
    timeout: 'timeout',
    cancelled: 'cancelled',
    unavailable: 'nagg.unavailable',
  },
  nostr: {
    network: 'network',
    timeout: 'timeout',
    cancelled: 'cancelled',
    unavailable: 'unavailable',
  },
  app: {
    network: 'network',
    timeout: 'timeout',
    cancelled: 'cancelled',
    unavailable: 'unavailable',
  },
};

/** Total UI formatter: unknown errors always get safe, service-specific copy.
 * No logging, mutation, storage, retries, or upstream text in the result.
 * Keep the original error for diagnostics and control flow. */
export function describeError(error: unknown, service: ErrorService): ErrorPresentation {
  const nodes = inspectError(error).unwrapOr([]);
  const types = nodes.flatMap((n) => [n.type, n.name, n.code]);
  const messages = nodes.flatMap((n) => n.messages);
  const matches = (pattern: RegExp) => messages.some((message) => pattern.test(message));
  const typeMatch = (rules: TypeRules) => rules.find(([type]) => types.includes(type))?.[1];
  const status = nodes.find((n) => n.status != null)?.status;
  const transport = TRANSPORT_COPY[service];

  // Numeric Cashu codes outrank HTTP 400 and wrapper prose. Unknown codes
  // deliberately stop classification; vendor-specific detail may mean something else.
  const protocolNode =
    service === 'cashu' ? [...nodes].reverse().find((n) => typeof n.code === 'number') : undefined;
  const protocolId =
    typeof protocolNode?.code === 'number'
      ? (CASHU_CODES[protocolNode.code] ?? 'cashu.unknown')
      : undefined;
  const sourceId = typeMatch(SOURCE_TYPES[service] ?? []);
  const modelId =
    service === 'routstr' && (status == null || status === 400 || status === 404)
      ? typeMatch([
          ['model_not_found', 'routstr.model_unavailable'],
          ['invalid_model', 'routstr.model_unavailable'],
        ])
      : undefined;
  const httpId =
    status == null
      ? undefined
      : (SOURCE_HTTP[service]?.[status] ??
        COMMON_HTTP[status] ??
        (status >= 500 && status < 600 ? transport.unavailable : undefined));
  const transportId = typeMatch([
    ['RateLimitError', 'rate_limited'],
    ['TimeoutError', transport.timeout],
    ['AbortError', transport.cancelled],
    ['aborted', transport.cancelled],
    ['NetworkError', transport.network],
    ['network', transport.network],
    ['network_error', transport.network],
  ]);
  const sdkId = service === 'cashu' ? typeMatch(CASHU_TYPES) : undefined;
  const textRules: readonly (readonly [RegExp, ErrorId])[] = [
    ...(service === 'cashu' ? CASHU_MESSAGE_RULES : []),
    ...(service === 'nostr'
      ? ([
          [/^rate-limited:/i, 'rate_limited'],
          [/^(?:blocked|restricted|invalid):/i, 'nostr.rejected'],
        ] as const)
      : []),
    [/\brate limit exceeded\b/i, 'rate_limited'],
    [/\b(?:timed out|timeout)\b/i, transport.timeout],
    [/\b(?:network request failed|failed to fetch|connection failed)\b/i, transport.network],
  ];
  const textId = textRules.find(([pattern]) => matches(pattern))?.[1];
  const id =
    protocolId ??
    sourceId ??
    modelId ??
    httpId ??
    transportId ??
    sdkId ??
    textId ??
    (status === 0 ? transport.network : `${service}.unknown`);
  return { id, text: ERROR_COPY[id] };
}
