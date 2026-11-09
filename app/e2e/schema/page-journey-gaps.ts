/** Pages no authored scenario reaches on at least one platform. The gate in
 * `page-journeys.test.ts` fails when a page has no journey and is not listed
 * here, and when a listed page gains one, so this list can only shrink.
 *
 * `capability`: the harness cannot produce the state the page needs; the
 * reason says what is missing. `unauthored`: nothing is in the way but the
 * work. Follow-up F22 stays open while any `unauthored` entry remains. */
import type { CANONICAL_PAGES } from './pages';

type Page = (typeof CANONICAL_PAGES)[number];
type JourneyGap = { kind: 'capability'; reason: string } | { kind: 'unauthored' };

const SECOND_DEVICE: JourneyGap = {
  kind: 'capability',
  reason: 'Needs a second device in Bluetooth range; no physical harness is approved.',
};
const ONCHAIN_BACKEND: JourneyGap = {
  kind: 'capability',
  reason: 'Needs a controlled chain backend; see ONCHAIN-RECEIVE and ONCHAIN-SEND in the ledger.',
};
const UNAUTHORED: JourneyGap = { kind: 'unauthored' };

export const PAGE_JOURNEY_GAPS: Partial<Record<Page, JourneyGap>> = {
  'bitchat-dm': SECOND_DEVICE,
  'bitchat-network': SECOND_DEVICE,
  'near-pay-peers': SECOND_DEVICE,
  'onchain-receive': ONCHAIN_BACKEND,
  'onchain-send': ONCHAIN_BACKEND,
  'ai-provider-select': UNAUTHORED,
  'ai-provider-info': UNAUTHORED,
  details: UNAUTHORED,
  'note-picker': UNAUTHORED,
  'emoji-picker': UNAUTHORED,
  'restore-gate': UNAUTHORED,
  'recovery-complete': UNAUTHORED,
  map: UNAUTHORED,
  'map-detail': UNAUTHORED,
  'geohash-chat': UNAUTHORED,
  'near-pay': UNAUTHORED,
  'payment-request': UNAUTHORED,
  'receive-message-ecash': UNAUTHORED,
  'signer-activity-detail': UNAUTHORED,
  'signer-app': UNAUTHORED,
  'signer-app-permissions': UNAUTHORED,
  'signer-app-person': UNAUTHORED,
  'signer-connect': UNAUTHORED,
  'signer-share': UNAUTHORED,
  'whitenoise-dm': UNAUTHORED,
};
