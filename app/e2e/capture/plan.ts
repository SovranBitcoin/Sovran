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
  'store.screenshots': 'd2e38759030f9a1cb138be51408417a204de7ba46cfb3f18199600350a363f85',
  'marketing.screenshots': '838d6f48785b5288c800d6effe292c98d277be2ad7e7e5de9932ad800121eec2',
  'marketing.screenshots.wallpapers':
    '85fc77e9ef516ac20b132458cdcf6b8bc84352d910cc96c19888670934584547',
  'marketing.screenshots.media': '1c6cec7d151c0c3d7be5454444011c78116aaf270d8b09592dc48ddd5ea24999',
  'marketing.screenshots.mints': 'f3d5541ff800ca4c3d79dbe3eabf857f7d80f9ab903aa4afad4b2c2a0ee32c48',
  'backup.flow': '089bd78e061b6fd390e885bffdd9c36b8abd356b571c4b3894a50cf5aed3baf5',
  'cta.preview': 'a8dca6e1dd687913ed392fdf6d60de4bee7bf812d919e4b1be318954c989b2c0',
  'profile.own.view': 'de1cd02ff2ba9c2a92f6eedc3ec8e1e27152435e47e56cba6985e0c5e82e3d96',
  'settings.routing.navigate': 'c908361b3002f4282c35d1582719ccd8dfa1c8665a29f7fcc7e9eb61a7c1dd1a',
  'settings.notification-policy':
    '23d5b4826309381372452c236adca32ba65c6afee166fdfc2b6f047372b1b21a',
  'settings.legal.navigate': '03db104b6da7d9a1ea2afebadb9ab80bcdb0bd8acfa3823919b2d1cdeefcb244',
  'settings.design-system.showcase':
    '96682a15fb47ec92ed65669b1218bfd926ffab9c9ce5e5b3430052ccad407cbd',
  'mint.add.cancel': 'a0c21c962af6b1e92e2765d389bf233cf59e9f8f0b6b585bb7819c60485ec759',
  'capture.settings': '4c8d1c63037eea7b3a245d40c3659448435d9e1f18eb0ae22cb0be8ea8091f8b',
  'capture.design-system': '999f147518d0a94a7dddeeb676007007b1e4e033c449e9800ad1c187e4699f96',
  'capture.history': '184660bdc7b8780e1156fd9699ac3a3b0213e03aa344fd735ff7a4e1e875262c',
  'capture.onboarding': 'd1c01ff942735e67fd68c40f51441b96cb87e930f3ae4b3430bb63070113b6b1',
  'capture.local-navigation': '07fbd4bcd34445b8c49d9842fc989969c657975756b0a14daf7932f8062c0bad',
  'wallet.search.no-results': 'd13343db24654cd7ff1be2cf24a24d827b95fba5465cadf063486036dde6334a',
  'profile.switcher': '8e368e52e4453d91befc53265f274555484e635e6561797a6013216be431ce69',
  'capture.account-entry': '8859915a9ded9e660b7edaff587a80ad0b242e9e052527444d078d01cdda8683',
  'capture.composer': 'cf4207b5a3f96ca70bc5a3f874e66856784a9f7e4c9107a917d2e8319d96727c',
  'capture.followers': '90e4c8e81be5825c8acbb633ee8b1ce2af72ff421a03cf38b7a2e12be6691530',
  'capture.receive-rails': '6db745b537b1aeaac47907398fe1edc33f1779bd1782daca1d8f213b493eafef',
  'capture.signer-lists': 'a35ad7b497d1c5a9e11356ae1e54b21c321fe666e0f6a8ed3e5cf7d4cf3962e6',
  'capture.storage': 'f2a5cc448363fb2fbe629056c6dc252c5bca4e4324d2286aa772f421928f4f3e',
  'capture.whitenoise-entry': 'ec48bbdac9aa2d65669abd970ef3b2a72f8b4b0d38e7a768b0a248a894bb7544',
  'capture.receive-qr-tabs': 'a908eaa1506be9a86dde98aeaa11f72bc1f82bf06445ad4439c5cff69a033ab6',
  'capture.mint-details': '41fa27c452ee42048b828f021945e5c4f2c495bd67db802ed3d01cb3539286c8',
  'capture.mint-updates': 'd9436c5a657554d4f16231175ce466e1f06daf71143887d420dc677f156195e8',
  'capture.wallpapers': '0035c6d03b452f566743d43c95d7b42c663e3ea696cc44cd81ca2b8560fffaa1',
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
  ['welcome', 'Welcome to Sovran'],
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
