import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadE2E } from '../core/loader';
import { expandScenario, type PlannedStep } from '../core/plan';
import { selectSuiteScenarios } from '../core/selection';
import { DRIVER_CAPS } from '../schema';
import { CANONICAL_PAGES } from '../schema/pages';
import { PAGE_ROUTES } from '../schema/page-routes';
import { LIBRARY_CAPTURE_PROFILE } from '../drivers/capture-profile';

export const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export type Platform = 'ios' | 'android';
type Page = (typeof CANONICAL_PAGES)[number];
type EvidenceClass = 'native-fixture' | 'native-navigation';
type Rule = {
  scenario: string;
  page: Page;
  occurrence: number;
  state: string;
  evidenceClass: EvidenceClass;
  readiness: string[];
  privacy: 'public-fixture' | 'disposable-profile';
};

// This allowlist reviews EFFECTS, not lane labels. No suite-wide execution.
const RECIPES: Record<string, string> = {
  'store.screenshots': 'store-screenshots',
  'marketing.screenshots': 'marketing-screenshots',
  'marketing.screenshots.wallpapers': 'marketing-screenshots',
  'marketing.screenshots.media': 'marketing-screenshots',
  'marketing.screenshots.mints': 'marketing-screenshots',
  'backup.flow': 'full',
  'cta.preview': 'full',
  'profile.own.view': 'full',
  'settings.routing.navigate': 'full',
  'settings.notification-policy': 'full',
  'settings.legal.navigate': 'full',
  'settings.design-system.showcase': 'full',
  'mint.add.cancel': 'full',
  'capture.settings': 'capture-library',
  'capture.design-system': 'capture-library',
  'capture.history': 'capture-library',
  'capture.onboarding': 'capture-library',
  'capture.local-navigation': 'capture-library',
  'wallet.search.no-results': 'full',
  'profile.switcher': 'full',
  'capture.account-entry': 'capture-library',
  'capture.composer': 'capture-library',
  'capture.signer-lists': 'capture-library',
  'capture.receive-rails': 'capture-library',
  'capture.followers': 'capture-library',
  'capture.whitenoise-entry': 'capture-library',
  'capture.storage': 'capture-library',
  'capture.receive-qr-tabs': 'capture-library',
  'capture.mint-details': 'capture-library',
  'capture.mint-updates': 'capture-library',
  'capture.wallpapers': 'capture-library',
};

const rules: Rule[] = [];
// Pin expanded steps, including setup/cleanup fixtures. A new tap in a previously
// reviewed scenario must not silently inherit permission to publish or spend.
const REVIEWED_STEPS: Record<string, string> = {
  'store.screenshots': 'a52bc34fb965b292b3cd6a120fcfd6e562f29d09993f54abddb8d45ca6ce5880',
  'marketing.screenshots': '450416c9fad96340bffb49213debaa305d255dd733499078dc191c71a84772b3',
  'marketing.screenshots.wallpapers':
    '0975631fb929f95d12fa4b28ca3e64acea5e0baeaa7d0d9e193834ba40a51897',
  'marketing.screenshots.media': '03f950e886a9f3666c8c9eb1c9929961e15d9c62bd1abe2d1349b2619dc814df',
  'marketing.screenshots.mints': '8f8454c37794890b03c0bf847e1f26adf470171b497672dabfd202e3bbfa95db',
  'backup.flow': '2523421b3c969266966ccadc6ff6ad44d105395e42736c2efde0a79e95fd176d',
  'cta.preview': '2c99d2f5d5347645bc82c8280e09d786baa7ea1ae1e9f802886fc90b852bc7f0',
  'profile.own.view': 'c8c64b57462630175aeb71c6927aab2cac816312d3333492fa819de3b318a4f5',
  'settings.routing.navigate': '462b2210f027bcecc1361f196dd48df9900ea2807e1956d67c958ac9d3f299bc',
  'settings.notification-policy':
    '9174926e593d4059945f2d370b1a572bde01ac872442ac95e9218b959117b27c',
  'settings.legal.navigate': '379403f0adf49be926fde51f2a9639620e951e004a61155b73b8723ef6e3d487',
  'settings.design-system.showcase':
    'c59b45b7926b6f97be2a4de4da3be920c5b6a587373516a1079ce94d96ed1d82',
  'mint.add.cancel': 'f52d653fac7807bd2d79a6a77110ed80c5a0e9929d864e2402c1f68578ddd580',
  'capture.settings': '9b1ff50938010a658ddc9aea04d6ae6718482af76c5290a5e501fe7cdcb4fdea',
  'capture.design-system': 'ee18722fe83cad765647e61042dbd644fa2b67645369609834ea5ab74ed90844',
  'capture.history': 'd6221d42e9d9e0cd051ff5e8999387d1c278f48e177c521b0ae40bc39213b54e',
  'capture.onboarding': '165d9d57552dbb9753bedf213e3e24a434c39b07d3c19f83f6eb95ad643382ae',
  'capture.local-navigation': '3b6bf9f69f0a16a27acf0ebb5f843d5865de10af1504cb5fd65486906b732966',
  'wallet.search.no-results': '3bcfd5f20343cb8a0afdfc22d53b348fae60abf6432642d1e36f75b187d6a925',
  'profile.switcher': 'ffe55146534437de435f0ab4de7d78ca16315d3ee13068ee8d6901058aea4e24',
  'capture.account-entry': 'aebcb34620a504625ed057e63ff664ab686878c431714fc03550b8050026b3e7',
  'capture.composer': '46a8e3f9628c210b4b55197c3e86aa805be81a4c94a20f34a386704219c5b2b0',
  'capture.followers': '7e07e9fdbe6dbc5e51ee6f371344e1927c8b5e80de455e9dcc83a74e6a686df3',
  'capture.receive-rails': 'd2146502d0f5eeb07896a9088bea6d329da8b92c2d121d861dd5074bee0f7c33',
  'capture.signer-lists': '5d90f000e686416889e2086ac9f37485e590c38586d9aa0527fd412162e6d990',
  'capture.storage': '1d2a9b32c8a98116e9b543e73133ff5bfaf63d121c58bced4d099fb0313c5f8b',
  'capture.whitenoise-entry': '65a50c9cb9ae4b65db2ce1bb5acbda2c31f013abbcc498d4065680264cd81c31',
  'capture.receive-qr-tabs': 'ac7f64b26fc5da32e6a437b33d22739ac10e05ba527db7ce4cc544600c45f879',
  'capture.mint-details': '29f68242fc2bc32c01c494934bfab029dce23ae71cb9dfbc64fc332f0f6d7f38',
  'capture.mint-updates': '535281bc1269acb66a59a1caed51a4b6a2b7544b3a2b02a16b73ec7ee586ed2b',
  'capture.wallpapers': 'f2944bcbb89fec5096eb9f45b63ddccf4899345323b06c722eb42a2b21f8ae47',
};
function recipe(
  scenario: string,
  evidenceClass: EvidenceClass,
  entries: [Page, string, number?, string?][]
) {
  for (const [page, readiness, occurrence = 1, state = 'default'] of entries)
    rules.push({
      scenario,
      page,
      occurrence,
      state,
      evidenceClass,
      readiness: [readiness],
      privacy: evidenceClass === 'native-fixture' ? 'public-fixture' : 'disposable-profile',
    });
}
recipe('capture.onboarding', 'native-navigation', [
  ['terms', 'terms-acceptance'],
  ['privacy', 'privacy-acknowledgment'],
  ['onboarding-carousel', 'Small payments on your phone'],
  ['onboarding-carousel', 'Carry your profile with you', 2, 'profile'],
  ['onboarding-carousel', 'Understand your privacy', 3, 'privacy'],
  ['onboarding-carousel', 'Start small', 4, 'start-small'],
]);
recipe('capture.local-navigation', 'native-navigation', [
  ['signer-hub', 'signer-hub-paste-row'],
  ['receive-amount', 'amount-next'],
  ['camera', 'Camera permission required'],
  ['not-found', 'not-found-go-wallet'],
]);
recipe('wallet.search.no-results', 'native-navigation', [['search', 'No Results Found']]);
recipe('profile.switcher', 'native-navigation', [['profile-switcher', 'profile-create']]);
recipe('store.screenshots', 'native-fixture', [
  ['wallet', 'wallet-selected-mint:mint.macadamia.cash'],
  ['transactions', 'screen-transactions'],
  ['lightning-receive', 'mint-quote-id-demo-mint-1'],
  ['contacts', 'contact-row:nostr:c673ff0b5f22'],
  ['ai', 'screen-ai'],
  ['balance-split', 'mint-distribution-next'],
  ['receive', 'receive-method-qrDisplay'],
]);
recipe('marketing.screenshots', 'native-fixture', [
  ['mint-select', 'mint-select-add'],
  ['mint-info', 'mint-info-reviews'],
  ['send', 'send-method-createEcash'],
  ['dm-chat', 'Coffee after the meetup?'],
  ['feed', 'demo-feed-ready'],
  ['notifications', 'screen-notifications'],
  ['settings', 'ACCOUNT'],
  ['ai', 'e2e-action-menu-open:model-picker', 2, 'model-picker'],
  ['receive-qr', 'payment-info-bip321-data'],
]);
recipe('marketing.screenshots.media', 'native-fixture', [
  ['thread', 'demo-thread-ready'],
  ['image-viewer', 'image-overlay-image-loaded'],
  ['stories', 'story-video-ready'],
]);
recipe('marketing.screenshots.mints', 'native-navigation', [
  ['mint-reviews', 'mint-reviews-profile-'],
  ['notification-mint-changes', 'mint-changes-populated'],
]);
recipe('mint.info.history', 'native-navigation', [['mint-history', 'mint-changes-detail']]);
recipe('marketing.screenshots.wallpapers', 'native-fixture', [
  ['theme-preview', 'theme-preview-theme-button'],
  ['gallery', 'album-card-artemis-ii-collection'],
  ['theme-background', 'wallpaper-option-navy'],
  ...[
    'navy',
    'sunset',
    'beige',
    'in-eclipse',
    'edge-of-lunar-day',
    'setting-earth',
    'new-moon',
    'looking-back-at-earth',
  ].map((name, i): [Page, string, number, string] => [
    'wallet',
    `Wallpaper image ${i < 3 ? 'none' : 'loaded'} for ${name}`,
    i + 1,
    name,
  ]),
]);
recipe('backup.flow', 'native-fixture', [
  ['backup-intro', 'Mock Mode - practice words only. This does not back up your wallet.'],
  ['backup-words', 'Word 12, yellow'],
  ['backup-verify', '1 of 12'],
  ['backup-done', 'backup-done'],
]);
recipe('cta.preview', 'native-fixture', [['cta', 'cta-active']]);
recipe('profile.own.view', 'native-navigation', [
  ['profile', 'user-profile:own'],
  ['drawer', 'drawer-profile-name'],
]);
recipe('settings.routing.navigate', 'native-navigation', [
  ['settings-routing', 'Min transfer amount'],
]);
recipe('settings.notification-policy', 'native-navigation', [
  ['settings-notification-policy', 'notification-policy-strict'],
  ['settings-notification-policy', 'notification-policy-relaxed', 2, 'strict'],
]);
recipe('settings.legal.navigate', 'native-navigation', [
  ['settings-terms', 'legal-document-terms'],
  ['settings-privacy', 'legal-document-privacy'],
]);
recipe('settings.design-system.showcase', 'native-fixture', [
  ['settings-design-system-timeline', 'Play'],
  ['settings-design-system-wallet-controls', 'AMOUNT · BTC AND SAT DISPLAY MODES'],
]);
recipe('mint.add.cancel', 'native-navigation', [
  ['mint-add', 'contact-row:mint:https://testnut.cashu.space'],
]);
recipe('capture.settings', 'native-navigation', [
  ['settings-edit-profile', 'edit-profile-name'],
  ['settings-network', 'settings-vertex-credits-toggle'],
  ['settings-media', 'settings-media-server-row'],
  ['settings-moderation', 'MESSAGE FILTER'],
  ['settings-delete', 'Save your NIP06'],
]);
recipe('capture.design-system', 'native-fixture', [
  ['settings-design-system', 'design-system-family-foundations'],
  ['settings-design-system-screens', 'ds-screens-unit-sat'],
  ['settings-design-system-variations', 'ds-subject-transaction-row'],
  ['settings-design-system-foundations', 'TYPE RAMP'],
  ['settings-design-system-loading', 'CURRENT STATE'],
  ['settings-design-system-segmented', 'Pause'],
  ['settings-design-system-empty-states', 'No posts yet'],
  ['settings-design-system-skeleton-crossfade', 'REGION WAVE + CROSSFADE'],
  ['settings-design-system-fade-stress', 'Run'],
  ['settings-design-system-posts', 'PLAIN POST (BASELINE)'],
]);
recipe('capture.history', 'native-fixture', [
  ['transaction-filters', 'filter-direction-incoming'],
  ['lightning-send', 'melt-quote-id-demo-melt-0'],
  ['send-token', 'send-token-id-demo-send-cancelled-2'],
  ['receive-token', 'receive-token-id-demo-receive-3'],
  ['swap', 'swap-id-demo-swap-5'],
]);
recipe('capture.account-entry', 'native-navigation', [
  ['claim-username', 'claim-username-input'],
  ['settings-recovery', 'recovery-cancel'],
  ['settings-keyring', 'keyring-public-keys-ready'],
  ['profile-share', 'payment-info-npub-data'],
]);
recipe('capture.composer', 'native-navigation', [['composer', 'composer-input']]);
recipe('capture.signer-lists', 'native-navigation', [
  ['signer-activity', 'No activity yet'],
  [
    'signer-requests',
    'New signing requests appear here, and as a prompt wherever you are in Sovran.',
  ],
]);
recipe('capture.receive-rails', 'native-navigation', [
  ['receive-rails', 'receive-rail-list-empty-paymentRequest'],
  ['receive-rails', 'receive-rail-list-empty-onchain', 2, 'onchain-empty'],
  ['receive-rails', 'receive-rail-list-empty-bolt12', 3, 'bolt12-empty'],
]);
recipe('capture.followers', 'native-navigation', [
  ['notification-followers', 'notification-followers-empty'],
]);
recipe('capture.whitenoise-entry', 'native-navigation', [
  ['whitenoise-setup', 'whitenoise-setup-uninitialized'],
]);
recipe('capture.storage', 'native-navigation', [['settings-storage', 'settings-storage-ready']]);
recipe('capture.wallpapers', 'native-navigation', [
  ['theme-background', 'wallpaper-option-navy', 1, 'colours-album'],
  ['wallet', 'Wallpaper image none for dark', 1, 'wallpaper-dark'],
  ['wallet', 'Wallpaper image none for light', 2, 'wallpaper-light'],
  ['wallet', 'Wallpaper image none for navy', 3, 'wallpaper-navy'],
  ['wallet', 'Wallpaper image none for sunset', 4, 'wallpaper-sunset'],
  ['wallet', 'Wallpaper image none for beige', 5, 'wallpaper-beige'],
  ['wallet', 'Wallpaper image none for crimson-night', 6, 'wallpaper-crimson-night'],
  ['wallet', 'Wallpaper image none for twilight-amber', 7, 'wallpaper-twilight-amber'],
  ['wallet', 'Wallpaper image none for velvet-emerald', 8, 'wallpaper-velvet-emerald'],
]);
recipe('capture.mint-updates', 'native-navigation', [
  ['notifications', 'mint-change-row:', 1, 'mints'],
  ['notification-mint-changes', 'mint-changes-populated', 1, 'minibits'],
  ['notification-mint-changes', 'mint-changes-populated', 2, 'macadamia'],
  ['notification-mint-changes', 'mint-changes-populated', 3, 'antifiat'],
  ['notification-mint-changes', 'mint-changes-populated', 4, 'cubabitcoin'],
]);
recipe('capture.mint-details', 'native-navigation', [
  ['mint-info', 'mint-info-reviews', 1, 'minibits'],
  ['mint-reviews', 'mint-reviews-profile-', 1, 'minibits'],
  ['mint-info', 'mint-info-reviews', 2, 'macadamia'],
  ['mint-reviews', 'mint-reviews-profile-', 2, 'macadamia'],
  ['mint-info', 'mint-info-reviews', 3, 'antifiat'],
  ['mint-reviews', 'mint-reviews-profile-', 3, 'antifiat'],
  ['mint-info', 'mint-info-reviews', 4, 'cubabitcoin'],
  ['mint-reviews', 'mint-reviews-profile-', 4, 'cubabitcoin'],
]);
recipe('capture.receive-qr-tabs', 'native-navigation', [
  ['receive-qr', 'receive-unified-rails-state', 1, 'unified'],
  ['receive-qr', 'receive-lightning-mode-address', 2, 'lightning-address'],
  ['receive-qr', 'receive-bolt12-find-mints', 3, 'bolt12-offer'],
  ['receive-qr', 'payment-info-address-data', 4, 'onchain'],
  ['receive-qr', 'receive-creq-p2pk-state', 5, 'cashu'],
]);

const BLOCKERS: Partial<Record<Page, string>> = {
  'settings-profile':
    'The profile screen renders three profile-secret inputs (nsec, NIP06, NUT13), and the screenshot mask is fail-closed on their geometry: every capture came back a whole-frame black, which the importer correctly refuses as non-evidence. Give the page an inert secret-free presentation fixture before capturing it.',
  'secure-locked':
    'recovery.secure-locked requires a manually prepared boot error on a disposable device; no automated fault fixture exists. Add that fixture and gate readiness first.',
  'profile-keys-error':
    'Add a supported unreadable-profile-key fixture and a visible re-import gate probe; do not corrupt real SecureStore.',
  splash:
    'Current onboarding screenshot is timer-only and can capture Terms under the splash name; add native splash visibility evidence.',
  'send-amount':
    'Zero-balance send correctly blocks entry; add supported presentation amount context without creating spendable proofs.',
  'rebalance-plan':
    'Existing zero-balance split has no valid plan; add supported inert plan fixture, never call rebalance execution.',
  'restore-gate':
    'Requires genuine recovery lifecycle fixture and guarded recovery-start prohibition; no destructive reinstall approved.',
  'recovery-complete':
    'Needs supported completed-recovery fixture with completion probe; a fabricated route is not completion evidence.',
  map: 'Add deterministic map-ready evidence after tiles load and a seeded public location; screen-map alone can be a loading shell.',
  'bitchat-dm':
    'No isolated native peer-conversation fixture; add fictional peer and messages with no Bluetooth send or live message exposure.',
  'bitchat-network':
    'NetworkSheet mounts useBLEPeers, which calls startBLE and announces identity. Add verified Bluetooth-denied preflight or an inert native transport fixture before navigation-only capture.',
  'geohash-chat':
    'Existing mesh journey can display live broadcasts; add an isolated public-fixture channel before publication.',
  'map-detail':
    'Needs a real fixture merchant selected through the map and hydrated detail probe, not a bare route.',
  'near-pay':
    'NearPayScreen mounts useFreshNearbyPeers/useBLEPeers: starts BLE, announces identity and eagerly favorites peers. Require verified Bluetooth-denied preflight or inert transport fixture.',
  'near-pay-peers':
    'NearPayPeerListScreen mounts useFreshNearbyPeers: even an initially empty list starts BLE and identity exchange. Require verified Bluetooth-denied preflight or inert transport fixture.',
  'onchain-receive':
    'No supported onchain history fixture; require a genuine inert quote model plus fail-closed address/invoice privacy.',
  'onchain-send':
    'No supported onchain history fixture; require inert validated history and no broadcast/pay action.',
  'payment-request':
    'Requires supported inert request state and fail-closed masking of transport/credential data; never deliver a request.',
  'signer-activity-detail':
    'Requires an existing fixture activity selected by ID with hydrated detail readiness.',
  'signer-app': 'Requires inert paired-app fixture with no connection or authorization effects.',
  'signer-app-permissions':
    'Requires fixture paired-app permissions and read-only navigation without granting permissions.',
  'signer-app-person':
    'Requires public fixture app/person association with hydrated identity readiness.',
  'signer-connect':
    'Connection strings can contain secrets; implement fail-closed redaction and inert connection preview first.',
  'signer-share':
    'ShareSignerScreen focus creates a live bunker bearer secret and starts the signer service. Require fail-closed pixel masking plus an inert pairing fixture; plain navigation is effectful.',
  'whitenoise-dm': 'No isolated MLS conversation fixture; do not expose live decrypted messages.',
};

interface CaptureTarget {
  platform: Platform;
  page: Page;
  state: string;
  baseline: boolean;
  scenario: string | null;
  occurrence: number | null;
  stepId: string | null;
  evidenceClass: EvidenceClass | 'unavailable';
  privacy: Rule['privacy'] | 'blocked';
  publicationEligibility: 'eligible-after-verification' | 'blocked';
  status: 'planned' | 'blocked';
  blocker: string | null;
  platformProfile: {
    driver: 'sim' | 'android';
    orientation: 'portrait';
    identity: 'disposable';
    effects: 'navigation-only';
  };
  readiness: string[];
  readinessStepIds: string[];
  routes: readonly string[];
}

function selectorText(step: PlannedStep): string | undefined {
  const s = step.step;
  const selector =
    s.action === 'tapUntil'
      ? s.until
      : s.action === 'waitFor' && !s.optional
        ? s.selector
        : s.action === 'assert' && s.that === 'visible'
          ? s.selector
          : undefined;
  return (
    selector &&
    ('id' in selector ? selector.id : 'idPrefix' in selector ? selector.idPrefix : selector.label)
  );
}

/** Offline only. All canonical baseline slots survive platform/recipe filtering. */
export function createCapturePlan(platforms: Platform[] = ['ios', 'android'], root = ROOT) {
  if (
    !platforms.length ||
    new Set(platforms).size !== platforms.length ||
    platforms.some((p) => !['ios', 'android'].includes(p))
  )
    throw new Error('Choose distinct native platforms');
  const loaded = loadE2E(join(root, 'app/e2e'));
  if (loaded.issues.length)
    throw new Error(`E2E validation failed: ${JSON.stringify(loaded.issues)}`);
  const targets: CaptureTarget[] = [];
  const occurrences = platforms.flatMap((platform) =>
    [...loaded.scenarios.values()].flatMap((scenario) => {
      const expanded = expandScenario(scenario, loaded.fixtures, {
        capabilities: new Set(DRIVER_CAPS[platform === 'ios' ? 'sim' : 'android']),
      });
      const counts = new Map<string, number>();
      return expanded.steps.flatMap(({ step, id, phase }) => {
        if (step.action !== 'screenshot') return [];
        const occurrence = (counts.get(step.name) ?? 0) + 1;
        counts.set(step.name, occurrence);
        return [
          {
            platform,
            page: step.name,
            scenario: scenario.id,
            occurrence,
            stepId: id,
            phase,
            platformSupported: expanded.availability === 'ready',
            effectReviewed: Object.hasOwn(RECIPES, scenario.id),
            blocker: Object.hasOwn(RECIPES, scenario.id)
              ? null
              : `Not selected: ${scenario.id} requires separate effect/privacy review; a ${scenario.lane} lane is not capture approval.`,
          },
        ];
      });
    })
  );
  const invocations = platforms.flatMap((platform) =>
    Object.entries(RECIPES).map(([scenario, suite]) => {
      const selected = selectSuiteScenarios(loaded.suites, loaded.scenarios, { suite, scenario });
      if (selected.scenarios.length !== 1 || selected.scenarios[0].id !== scenario)
        throw new Error(`Unsafe predecessor selection: ${scenario}`);
      const source = selected.scenarios[0];
      const expanded = expandScenario(source, loaded.fixtures, {
        capabilities: new Set(DRIVER_CAPS[platform === 'ios' ? 'sim' : 'android']),
      });
      if (
        source.lane !== 'simulator' ||
        source.funds ||
        expanded.requires.some((r) => r !== 'fresh-install') ||
        expanded.steps.some((s) =>
          [
            'exec',
            'counterparty',
            'capture',
            'setClipboard',
            'setPaymentRequestClipboard',
            'mintFaults',
          ].includes(s.action)
        )
      )
        throw new Error(`Unsafe capture recipe: ${scenario}`);
      const counts = new Map<string, number>();
      const recipeSha256 = createHash('sha256')
        .update(JSON.stringify(expanded.steps))
        .digest('hex');
      const captures = expanded.steps.flatMap((planned) => {
        if (planned.step.action !== 'screenshot') return [];
        const page = planned.step.name;
        const occurrence = (counts.get(page) ?? 0) + 1;
        counts.set(page, occurrence);
        return [{ page, occurrence, stepId: planned.id, index: planned.index }];
      });
      for (const rule of rules.filter((r) => r.scenario === scenario)) {
        const capture = captures.find(
          (c) => c.page === rule.page && c.occurrence === rule.occurrence
        );
        if (!capture)
          throw new Error(`Missing authored capture: ${scenario}/${rule.page}/${rule.occurrence}`);
        const before = expanded.steps.filter((s) => s.index < capture.index);
        const guards = rule.readiness.map(
          (anchor) => before.findLast((s) => selectorText(s) === anchor)?.id
        );
        const blocker =
          recipeSha256 !== REVIEWED_STEPS[scenario]
            ? `Re-review effects/privacy for changed recipe ${scenario}, including expanded fixtures, then update REVIEWED_STEPS.`
            : expanded.availability !== 'ready'
              ? expanded.deferredReason!
              : guards.some((id) => !id)
                ? `Add mandatory readiness wait for ${rule.readiness.join(', ')} immediately before ${capture.stepId}`
                : null;
        targets.push({
          ...rule,
          platform,
          baseline: rule.state === 'default',
          stepId: capture.stepId,
          status: blocker ? 'blocked' : 'planned',
          blocker,
          publicationEligibility: blocker ? 'blocked' : 'eligible-after-verification',
          platformProfile: {
            driver: platform === 'ios' ? 'sim' : 'android',
            orientation: 'portrait',
            identity: 'disposable',
            effects: 'navigation-only',
          },
          readinessStepIds: guards.filter((id): id is string => !!id),
          routes: PAGE_ROUTES[rule.page] ?? [],
        });
      }
      return {
        platform,
        suite,
        scenario,
        scenarios: [
          {
            id: scenario,
            lane: source.lane,
            endState: source.endState,
            captures,
            steps: expanded.steps,
          },
        ],
        recipeSha256,
      };
    })
  );
  for (const platform of platforms)
    for (const page of CANONICAL_PAGES) {
      if (targets.some((t) => t.platform === platform && t.page === page && t.baseline)) continue;
      targets.push({
        platform,
        page,
        state: 'default',
        baseline: true,
        scenario: null,
        occurrence: null,
        stepId: null,
        evidenceClass: 'unavailable',
        privacy: 'blocked',
        publicationEligibility: 'blocked',
        status: 'blocked',
        blocker:
          BLOCKERS[page] ??
          `Review ${PAGE_ROUTES[page]?.join(', ') || page} and add an effect-reviewed recipe with page-specific readiness; no recipe is approved for this canonical page.`,
        platformProfile: {
          driver: platform === 'ios' ? 'sim' : 'android',
          orientation: 'portrait',
          identity: 'disposable',
          effects: 'navigation-only',
        },
        readiness: [],
        readinessStepIds: [],
        routes: PAGE_ROUTES[page] ?? [],
      });
    }
  targets.sort(
    (a, b) =>
      a.platform.localeCompare(b.platform) ||
      CANONICAL_PAGES.indexOf(a.page) - CANONICAL_PAGES.indexOf(b.page) ||
      a.state.localeCompare(b.state)
  );
  for (const platform of platforms) {
    const base = targets.find(
      (t) => t.platform === platform && t.page === 'receive-qr' && t.baseline
    )!;
    targets.push({
      ...base,
      baseline: false,
      state: 'p2pk',
      scenario: 'receive.qr-display.tabs',
      occurrence: 6,
      stepId: null,
      readiness: [],
      readinessStepIds: [],
      status: 'blocked',
      publicationEligibility: 'blocked',
      privacy: 'blocked',
      blocker:
        'Press P2PK variant exists, but its full tabs journey adds live mints. Isolate the display-only leg and verify public-request QR privacy before selecting it.',
    });
  }
  return {
    version: 1 as const,
    captureProfile: LIBRARY_CAPTURE_PROFILE,
    baselineDenominator: CANONICAL_PAGES.length * platforms.length,
    targets,
    occurrences,
    invocations: invocations.filter((i) =>
      targets.some(
        (t) => t.platform === i.platform && t.scenario === i.scenario && t.status === 'planned'
      )
    ),
    blocked: targets.filter((t) => t.status === 'blocked'),
  };
}
export type CapturePlan = ReturnType<typeof createCapturePlan>;
