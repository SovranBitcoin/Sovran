/**
 * @jest-environment node
 *
 * The id → actions table is the whole decision a failed AI turn makes. It is
 * pure, so it is cheap to pin exactly: what each catalogue id offers, that the
 * table covers every id the routstr path can produce, and that an id from
 * outside that vocabulary still gets an honest offer rather than a crash.
 */
import {
  CHAT_ERROR_ACTION_LABELS,
  chatErrorActions,
  type ChatErrorActionId,
  type ChatErrorId,
} from '@/features/ai/lib/chatErrorActions';
import { describeError } from '@/shared/lib/errors';
import { ERROR_COPY, type ErrorId } from '@/shared/lib/errors/catalog';

/** Every id the chat is meant to answer for. Declared here rather than
 *  imported so the table and its coverage claim cannot drift together. */
const CHAT_IDS = [
  ...(Object.keys(ERROR_COPY) as ErrorId[]).filter((id) => id.startsWith('routstr.')),
  'cancelled',
  'forbidden',
  'rate_limited',
] as ChatErrorId[];

describe('chatErrorActions', () => {
  it.each([
    // A shortfall is money. Only money, or spending less, clears it — a retry
    // is deliberately not offered.
    ['routstr.balance', ['top-up', 'change-model']],
    // The model is gone from the catalogue; nothing else helps.
    ['routstr.model_unavailable', ['change-model']],
    // The user's chosen provider refused. Switching leads, retry trails.
    ['routstr.provider_refused', ['change-provider', 'retry']],
    // Slow, not broken.
    ['routstr.timeout', ['retry']],
    // Nothing was chosen yet.
    ['routstr.no_provider', ['change-provider']],
    // This provider takes none of our mints; asking it again cannot change that.
    ['routstr.mint_not_accepted', ['change-provider']],
    // The message itself was rejected — re-sending the same bytes repeats it.
    ['routstr.invalid_request', ['change-model']],
  ] as const)('offers %s → %p', (id, expected) => {
    expect(chatErrorActions(id)).toEqual(expected);
  });

  it('never offers a bare retry for a failure a retry cannot clear', () => {
    for (const id of ['routstr.balance', 'routstr.model_unavailable', 'routstr.invalid_request']) {
      expect(chatErrorActions(id as ErrorId)).not.toEqual(['retry']);
    }
  });

  it('answers for every id the routstr path can produce', () => {
    for (const id of CHAT_IDS) {
      const actions = chatErrorActions(id);
      expect(actions.length).toBeGreaterThan(0);
      // Each offer must be one the pill knows how to render and dispatch.
      for (const action of actions) {
        expect(CHAT_ERROR_ACTION_LABELS[action as ChatErrorActionId]).toBeDefined();
      }
    }
  });

  it('covers what describeError actually classifies routstr failures as', () => {
    // Representative failures rather than a status sweep: the point is that
    // the classifier's output lands inside this table, not that we can
    // re-enumerate the classifier.
    const failures: unknown[] = [
      { status: 402, error: { code: 'insufficient_balance' } },
      { status: 402, error: { message: 'Payment Required' } },
      { status: 404, error: { message: 'Not found' } },
      { status: 429, error: { message: 'Too many requests' } },
      { status: 502, error: { message: 'Bad gateway' } },
      { status: 503, error: { type: 'no_providers' } },
      { status: 503, error: { type: 'provider_refused' } },
      { error: { type: 'mint_not_accepted' } },
      new Error('network request failed'),
    ];
    for (const failure of failures) {
      const { id } = describeError(failure, 'routstr');
      expect(CHAT_IDS).toContain(id);
      expect(chatErrorActions(id).length).toBeGreaterThan(0);
    }
  });

  it('falls back to retry for an id outside the chat vocabulary', () => {
    // A cashu id can only reach here by a wiring mistake. Retry is the one
    // offer that is true of any failure, and it must not throw.
    expect(chatErrorActions('cashu.proofs_spent')).toEqual(['retry']);
  });

  it('is pure — the same id always answers the same, by value', () => {
    expect(chatErrorActions('routstr.timeout')).toEqual(chatErrorActions('routstr.timeout'));
  });
});

// "The model list has not loaded yet. Check your connection" is false when the
// list DID load and this node simply serves nothing usable — and it sends the
// user to retry a connection that is working. The two absences look identical
// at the call site, so they are separated by whether a lineup exists.
describe('a catalogue that landed and offers nothing', () => {
  // Like `routstr.e2ee_unavailable`, this id is raised by the send path
  // itself rather than classified off a wire code, so the copy is what there
  // is to assert.
  it('does not tell the user to check a connection that is fine', () => {
    const text = ERROR_COPY['routstr.no_usable_models'];
    expect(text).not.toContain('connection');
    expect(text).toContain('Choose another provider');
    expect(ERROR_COPY['routstr.catalog_unavailable']).toContain('connection');
  });

  it('offers no retry, because the same node answers the same', () => {
    expect(chatErrorActions('routstr.no_usable_models')).toEqual([
      'change-provider',
      'change-model',
    ]);
  });

  it('keeps retry for a list that genuinely has not loaded', () => {
    expect(chatErrorActions('routstr.catalog_unavailable')).toContain('retry');
  });
});
