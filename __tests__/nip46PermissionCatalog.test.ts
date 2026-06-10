/**
 * Pins the signer permission catalog: completeness (every NIP-46 method ×
 * representative kinds resolves to copy), the plan's verbatim copy table,
 * tier derivation staying in lockstep with classifyRequest, and the
 * non-negotiable that wallet-tier/critical-key requests never offer
 * Always Allow.
 */

import {
  ACTIVITY_VERDICT_DISPLAY,
  allHandledToastCopy,
  alwaysAllowEligible,
  alwaysScopeFootnote,
  appDisplayName,
  autoSignedToastCopy,
  boundDisplay,
  encryptedPayloadLabel,
  expiredNoticeCopy,
  permissionEntryFor,
  permissionEntryForGrantKey,
  permissionTierFor,
  queueStripLabel,
  requestsWaitingToastCopy,
  tierBannerFor,
  UNNAMED_APP_LABEL,
  type CopySegment,
  type PermissionLookup,
} from '@/features/nostrSigner/components/permissionCatalog';
import {
  ActivityVerdictSchema,
  Nip46MethodSchema,
  type Nip46Method,
} from '@/features/nostrSigner/lib/nip46Types';
import { classifyRequest } from '@/features/nostrSigner/lib/permissionPolicy';

const APP = 'Primal';

function joined(segments: CopySegment[]): string {
  return segments.map((segment) => segment.text).join('');
}

function bodyText(lookup: PermissionLookup, appName = APP): string {
  return joined(permissionEntryFor(lookup).body({ appName }));
}

// Every kind the policy module treats distinctly, plus unknown representatives.
const REPRESENTATIVE_KINDS = [
  0, 1, 3, 4, 5, 6, 7, 13, 14, 16, 1059, 1111, 9734, 10002, 22242, 27235, 30078, 17375, 7375, 7374,
  7376, 9321, 10019, 24133, 31337, 65535,
];

describe('catalog completeness', () => {
  it.each(Nip46MethodSchema.options)('method %s yields a complete entry', (method) => {
    const entry = permissionEntryFor({ method });
    expect(entry.headline.length).toBeGreaterThan(0);
    expect(joined(entry.body({ appName: APP })).length).toBeGreaterThan(0);
    expect(entry.alwaysVerbPhrase.length).toBeGreaterThan(0);
    expect(entry.icon).toMatch(/^[a-z0-9-]+:[a-z0-9:-]+$/);
    expect(entry.permissionEditorLabel.length).toBeGreaterThan(0);
    expect(['basic', 'content', 'account', 'wallet']).toContain(entry.permissionEditorGroup);
  });

  it.each(REPRESENTATIVE_KINDS)('sign_event kind %i yields a complete entry', (kind) => {
    const entry = permissionEntryFor({ method: 'sign_event', kind });
    expect(entry.headline.length).toBeGreaterThan(0);
    const body = joined(entry.body({ appName: APP }));
    expect(body).toContain(APP);
    expect(entry.icon.length).toBeGreaterThan(0);
  });

  it('every activity verdict has a display row', () => {
    for (const verdict of ActivityVerdictSchema.options) {
      const display = ACTIVITY_VERDICT_DISPLAY[verdict];
      expect(display.label.length).toBeGreaterThan(0);
      expect(['success', 'danger', 'warning']).toContain(display.tone);
    }
  });
});

describe('copy table (plan, verbatim)', () => {
  it('get_public_key', () => {
    expect(permissionEntryFor({ method: 'get_public_key' }).headline).toBe('Share Public Key');
    expect(bodyText({ method: 'get_public_key' })).toBe(
      "Primal wants to see your public key (npub). This identifies you but can't post or spend."
    );
  });

  it('sign kind 1', () => {
    const entry = permissionEntryFor({ method: 'sign_event', kind: 1 });
    expect(entry.headline).toBe('Publish a Post');
    expect(entry.alwaysVerbPhrase).toBe('sign posts');
    expect(bodyText({ method: 'sign_event', kind: 1 })).toBe(
      'Primal wants to sign a public post as you.'
    );
  });

  it.each([6, 16])('sign kind %i (repost)', (kind) => {
    const entry = permissionEntryFor({ method: 'sign_event', kind });
    expect(entry.headline).toBe('Repost a Note');
    expect(bodyText({ method: 'sign_event', kind })).toBe('Primal wants to repost a note as you.');
  });

  it('sign kind 7 (react)', () => {
    expect(bodyText({ method: 'sign_event', kind: 7 })).toBe(
      'Primal wants to react with "+" as you.'
    );
  });

  it.each([4, 14, 1059])('sign kind %i (private message)', (kind) => {
    const entry = permissionEntryFor({ method: 'sign_event', kind });
    expect(entry.headline).toBe('Send a Private Message');
    expect(bodyText({ method: 'sign_event', kind })).toBe(
      'Primal wants to sign an encrypted message from you.'
    );
  });

  it('sign kind 0 (profile)', () => {
    expect(permissionEntryFor({ method: 'sign_event', kind: 0 }).headline).toBe(
      'Update Your Profile'
    );
    expect(bodyText({ method: 'sign_event', kind: 0 })).toBe(
      'Primal wants to change your public profile — name, picture, and bio.'
    );
  });

  it('sign kind 3 (follows)', () => {
    expect(bodyText({ method: 'sign_event', kind: 3 })).toBe(
      'Primal wants to update who you follow. This replaces your entire follow list.'
    );
  });

  it('sign kind 5 (deletion)', () => {
    expect(permissionEntryFor({ method: 'sign_event', kind: 5 }).headline).toBe(
      'Delete Your Content'
    );
    expect(bodyText({ method: 'sign_event', kind: 5 })).toBe(
      'Primal wants to permanently request deletion of your events.'
    );
  });

  it('sign kind 10002 (relays)', () => {
    expect(bodyText({ method: 'sign_event', kind: 10002 })).toBe(
      'Primal wants to update where your data is published and read.'
    );
  });

  it.each([22242, 27235])('sign kind %i (login) interpolates the relay', (kind) => {
    const entry = permissionEntryFor({ method: 'sign_event', kind });
    expect(entry.headline).toBe('Log In to a Service');
    expect(joined(entry.body({ appName: APP, relayLabel: 'relay.damus.io' }))).toBe(
      'Primal wants to prove your identity to relay.damus.io.'
    );
    expect(joined(entry.body({ appName: APP }))).toBe(
      'Primal wants to prove your identity to a service.'
    );
  });

  it('sign kind 30078 (app data)', () => {
    expect(bodyText({ method: 'sign_event', kind: 30078 })).toBe(
      'Primal wants to store app settings under your identity.'
    );
  });

  it.each([17375, 7375, 7374, 7376, 9321, 10019])('sign NIP-60 kind %i (wallet)', (kind) => {
    const entry = permissionEntryFor({ method: 'sign_event', kind });
    expect(entry.headline).toBe('Wallet Access Request');
    expect(bodyText({ method: 'sign_event', kind })).toBe(
      'Primal wants to sign a Cashu wallet event. This can move or expose your ecash.'
    );
  });

  it('sign unknown kind', () => {
    const entry = permissionEntryFor({ method: 'sign_event', kind: 31337 });
    expect(entry.headline).toBe('Sign Event (kind 31337)');
    expect(bodyText({ method: 'sign_event', kind: 31337 })).toBe(
      "Primal wants to sign an event type Sovran doesn't recognize. Review the raw event before allowing."
    );
  });

  it.each(['nip04_encrypt', 'nip44_encrypt'] as const)('%s interpolates the peer', (method) => {
    const entry = permissionEntryFor({ method });
    expect(entry.headline).toBe('Encrypt a Message');
    expect(joined(entry.body({ appName: APP, peerLabel: 'abcd1234…ef56' }))).toBe(
      'Primal wants to encrypt a message to abcd1234…ef56 so only they can read it.'
    );
  });

  it.each(['nip04_decrypt', 'nip44_decrypt'] as const)('%s', (method) => {
    const entry = permissionEntryFor({ method });
    expect(entry.headline).toBe('Decrypt Your Data');
    expect(bodyText({ method })).toBe(
      'Primal wants to read encrypted data sent to you. Allowing reveals private content to this app.'
    );
  });

  it('bolds exactly the app name segment', () => {
    const segments = permissionEntryFor({ method: 'sign_event', kind: 1 }).body({ appName: APP });
    expect(segments[0]).toEqual({ text: APP, bold: true });
    expect(segments.slice(1).every((segment) => segment.bold !== true)).toBe(true);
  });
});

describe('tier derivation (classifyRequest is the source of truth)', () => {
  it.each([1, 6, 16, 7, 1111])('normal kind %i → standard', (kind) => {
    expect(permissionTierFor({ method: 'sign_event', kind })).toBe('standard');
  });

  it.each([0, 3, 4, 13, 14, 1059, 10002, 22242, 27235, 30078])(
    'sensitive kind %i → protected',
    (kind) => {
      expect(permissionTierFor({ method: 'sign_event', kind })).toBe('protected');
    }
  );

  it.each([17375, 7375, 7374, 7376, 9321, 10019])('wallet kind %i → wallet', (kind) => {
    expect(permissionTierFor({ method: 'sign_event', kind })).toBe('wallet');
  });

  it.each(['nip04_decrypt', 'nip44_decrypt'] as const)('%s → wallet', (method) => {
    expect(permissionTierFor({ method })).toBe('wallet');
  });

  it.each(['nip04_encrypt', 'nip44_encrypt'] as const)('%s → protected', (method) => {
    expect(permissionTierFor({ method })).toBe('protected');
  });

  it('unknown sign kinds get the unknown presentation, not protected', () => {
    expect(classifyRequest({ method: 'sign_event', kind: 31337 }).class).toBe('sensitive');
    expect(permissionTierFor({ method: 'sign_event', kind: 31337 })).toBe('unknown');
  });

  it('kind-5 scope escalation reaches the wallet tier', () => {
    const walletScoped = JSON.stringify({
      kind: 5,
      content: '',
      tags: [['k', '17375']],
      created_at: 1_700_000_000,
    });
    expect(permissionTierFor({ method: 'sign_event', kind: 5, params: [walletScoped] })).toBe(
      'wallet'
    );
    const harmless = JSON.stringify({
      kind: 5,
      content: '',
      tags: [['k', '1']],
      created_at: 1_700_000_000,
    });
    expect(permissionTierFor({ method: 'sign_event', kind: 5, params: [harmless] })).toBe(
      'protected'
    );
  });
});

describe('Always Allow ceiling', () => {
  it.each([17375, 7375, 7374, 7376, 9321, 10019])('wallet kind %i never offers it', (kind) => {
    expect(alwaysAllowEligible({ method: 'sign_event', kind })).toBe(false);
  });

  it.each(['nip04_decrypt', 'nip44_decrypt'] as const)('%s never offers it', (method) => {
    expect(alwaysAllowEligible({ method })).toBe(false);
  });

  it('kind 5 never offers it, even for a harmless-scoped request', () => {
    const harmless = JSON.stringify({
      kind: 5,
      content: '',
      tags: [['k', '1']],
      created_at: 1_700_000_000,
    });
    expect(alwaysAllowEligible({ method: 'sign_event', kind: 5, params: [harmless] })).toBe(false);
  });

  it('auto-class methods have nothing to grant', () => {
    for (const method of ['ping', 'get_public_key', 'connect'] as Nip46Method[]) {
      expect(alwaysAllowEligible({ method })).toBe(false);
    }
  });

  it.each([1, 6, 7, 1111])('normal kind %i offers it', (kind) => {
    expect(alwaysAllowEligible({ method: 'sign_event', kind })).toBe(true);
  });

  it.each([0, 3, 10002, 30078])('sensitive kind %i offers it (with warning tier)', (kind) => {
    expect(alwaysAllowEligible({ method: 'sign_event', kind })).toBe(true);
  });
});

describe('banners and footnote (plan, verbatim)', () => {
  it('standard has no banner', () => {
    expect(tierBannerFor('standard', APP)).toBeNull();
  });

  it('protected warning banner', () => {
    const banner = tierBannerFor('protected', APP);
    expect(banner?.tone).toBe('warning');
    expect(joined(banner!.segments)).toBe(
      'Sensitive permission — this changes or reveals core account data.'
    );
  });

  it('wallet danger banner interpolates the app', () => {
    const banner = tierBannerFor('wallet', APP);
    expect(banner?.tone).toBe('danger');
    expect(joined(banner!.segments)).toBe(
      'Highly sensitive — this touches your wallet. Only approve if you started this action in Primal just now.'
    );
  });

  it('unknown warning banner', () => {
    expect(joined(tierBannerFor('unknown', APP)!.segments)).toBe(
      "Unrecognized event type. If you didn't expect this, deny it."
    );
  });

  it('always-scope footnote', () => {
    expect(joined(alwaysScopeFootnote(APP, 'sign posts'))).toBe(
      'Always Allow lets Primal sign posts without asking. Change anytime in Connected Apps.'
    );
  });
});

describe('labels, toasts, and bounds', () => {
  it('decrypt preview label', () => {
    expect(encryptedPayloadLabel(412)).toBe('Encrypted payload · 412 chars');
  });

  it('queue strip label', () => {
    expect(queueStripLabel(2, 5)).toBe('Request 2 of 5');
  });

  it('requests-waiting toast copy', () => {
    expect(requestsWaitingToastCopy(3)).toEqual({
      label: 'Requests waiting',
      description: '3 requests are in your queue. Open Signer to review.',
    });
    expect(requestsWaitingToastCopy(1).description).toBe(
      '1 request is in your queue. Open Signer to review.'
    );
  });

  it('all-handled toast copy', () => {
    expect(allHandledToastCopy(4, 1)).toEqual({
      label: 'All requests handled',
      description: '4 allowed · 1 denied',
    });
  });

  it('expired notice copy', () => {
    expect(expiredNoticeCopy(APP)).toBe(
      'This request expired. Primal stopped waiting for a response.'
    );
  });

  it('auto-signed toast copy', () => {
    expect(autoSignedToastCopy(APP, 'Publish a Post')).toEqual({
      label: 'Auto-signed for Primal',
      description: 'Publish a Post · change in Connected Apps',
    });
  });

  it('auto-signed verdict carries the plan accent line', () => {
    expect(ACTIVITY_VERDICT_DISPLAY.auto_approved_grant.accentLine).toBe(
      'Auto-signed — Always Allow'
    );
    expect(ACTIVITY_VERDICT_DISPLAY.auto_approved_grant.icon).toBe('mdi:check-decagram');
    expect(ACTIVITY_VERDICT_DISPLAY.expired.tone).toBe('warning');
    expect(ACTIVITY_VERDICT_DISPLAY.denied_once.tone).toBe('danger');
  });

  it('bounds untrusted display strings', () => {
    const hostile = 'X'.repeat(500);
    expect(boundDisplay(hostile, 48).length).toBe(48);
    expect(appDisplayName({ name: hostile }).length).toBeLessThanOrEqual(48);
    expect(appDisplayName({ name: '  ' })).toBe(UNNAMED_APP_LABEL);
    expect(appDisplayName(undefined)).toBe(UNNAMED_APP_LABEL);
    const bodyWithHostileApp = permissionEntryFor({ method: 'sign_event', kind: 1 }).body({
      appName: hostile,
    });
    expect(bodyWithHostileApp[0].text.length).toBeLessThanOrEqual(48);
  });

  it('grant-key lookup matches the request lookup', () => {
    expect(permissionEntryForGrantKey('sign_event:1').headline).toBe('Publish a Post');
    expect(permissionEntryForGrantKey('sign_event:17375').tier).toBe('wallet');
    expect(permissionEntryForGrantKey('nip44_decrypt').permissionEditorGroup).toBe('wallet');
    expect(permissionEntryForGrantKey('sign_event:31337').headline).toBe('Sign Event (kind 31337)');
  });
});
