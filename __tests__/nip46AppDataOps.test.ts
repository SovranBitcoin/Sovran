/**
 * Pins the GENERIC NIP-78 humanizer against the real kind-30078 payloads
 * Primal Web signs (captured live) — verb_object heuristic, subkey naming,
 * NIP-31 alt fallback, substring-based wallet-risk escalation (renamed ops
 * must still escalate), and hostile-length bounding.
 */

import { appDataOperationFor } from '@/features/nostrSigner/lib/appDataOps';

const PRIMAL_D = (op: string): string[][] => [['d', 'Primal-Web App', op]];

describe('appDataOperationFor — verb_object heuristic (live Primal payloads)', () => {
  it('humanizes get_app_settings without using the app-controlled description', () => {
    const op = appDataOperationFor(
      PRIMAL_D('get_app_settings'),
      '{ "description": "Sync app settings" }'
    );
    expect(op.headline).toBe('Load App Settings');
    expect(op.verbPhrase).toBe('load app settings');
    expect(op.risk).toBeUndefined();
  });

  it('humanizes set_app_settings', () => {
    const op = appDataOperationFor(PRIMAL_D('set_app_settings'), '{}');
    expect(op.headline).toBe('Save App Settings');
    expect(op.verbPhrase).toBe('save app settings');
  });

  it('prefers the content subkey for subsettings ops', () => {
    const op = appDataOperationFor(
      PRIMAL_D('get_app_subsettings_home'),
      '{"subkey":"user-home-feeds"}'
    );
    expect(op.headline).toBe('Load App Settings');
    expect(op.verbPhrase).toBe('load your home feeds settings');
  });

  it('humanizes subsettings ops without a subkey too', () => {
    const op = appDataOperationFor(PRIMAL_D('get_app_subsettings_reads'), '{}');
    expect(op.headline).toBe('Load App Settings Reads');
    expect(op.verbPhrase).toBe('load app settings reads');
  });

  it('escalates nwc subsettings as wallet-credential access (live payload)', () => {
    const op = appDataOperationFor(PRIMAL_D('get_app_subsettings_nwc'), '{"subkey":"user-nwc"}');
    expect(op.verbPhrase).toBe('load your wallet (NWC) settings');
    expect(op.risk).toBe('wallet_credential');
  });

  it('escalates by SUBSTRING — a renamed wallet op cannot drop the banner', () => {
    expect(appDataOperationFor(PRIMAL_D('get_wallet_backup_v2'), '{}').risk).toBe(
      'wallet_credential'
    );
    expect(appDataOperationFor(PRIMAL_D('load_nwc_connections'), '{}').risk).toBe(
      'wallet_credential'
    );
  });

  it('humanizes reset_direct_message_count without leaking the peer hex', () => {
    const op = appDataOperationFor(
      PRIMAL_D('reset_direct_message_count'),
      '{ "description": "reset messages from \'1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2\'"}'
    );
    expect(op.headline).toBe('Reset Direct Message Count');
    expect(op.verbPhrase).toBe('reset direct message count');
    expect(op.verbPhrase).not.toContain('1e53e900');
  });

  it("reads Primal's verbatim notifications typo as Sync …", () => {
    const op = appDataOperationFor(PRIMAL_D('notifications_laste_seen'), '{}');
    expect(op.headline).toBe('Sync Notifications Last Seen');
    expect(op.verbPhrase).toBe('sync notifications last seen with your account');
  });

  it('verbless ops read as Sync … (membership_*)', () => {
    const op = appDataOperationFor(PRIMAL_D('membership_status'), '{}');
    expect(op.headline).toBe('Sync Membership Status');
  });

  it('humanizes mark_all_dms_as_read with the dms rewrite', () => {
    const op = appDataOperationFor(PRIMAL_D('mark_all_dms_as_read'), '{}');
    expect(op.headline).toBe('Mark All Messages As Read');
    expect(op.verbPhrase).toBe('mark all messages as read');
  });

  it('humanizes report_user and change_premium_name', () => {
    expect(appDataOperationFor(PRIMAL_D('report_user'), '{}').verbPhrase).toBe('report user');
    expect(appDataOperationFor(PRIMAL_D('change_premium_name'), '{}').headline).toBe(
      'Update Premium Name'
    );
  });

  it('shows single-word operations bounded and quoted', () => {
    const op = appDataOperationFor(PRIMAL_D('brandnewop'), '{}');
    expect(op.verbPhrase).toBe("sync app data ('brandnewop') with your account");
  });
});

describe('appDataOperationFor — generic fallbacks', () => {
  it('uses content subkey when the d tag has no operation element', () => {
    const op = appDataOperationFor([['d', 'SomeApp']], '{"subkey":"user-nwc"}');
    expect(op.verbPhrase).toBe('load your wallet (NWC) settings');
    expect(op.risk).toBe('wallet_credential');
  });

  it('quotes an app-provided description', () => {
    const op = appDataOperationFor([['d', 'SomeApp']], '{"description":"Sync app settings"}');
    expect(op.verbPhrase).toBe('sync app data ("Sync app settings")');
  });

  it('honors a NIP-31 alt tag when nothing else names the action', () => {
    const op = appDataOperationFor(
      [
        ['d', 'SomeApp'],
        ['alt', 'Bookmark sync for ExampleApp'],
      ],
      '{}'
    );
    expect(op.verbPhrase).toBe('sync app data ("Bookmark sync for ExampleApp")');
  });

  it('handles Coracle-style namespaced d tags', () => {
    const op = appDataOperationFor([['d', 'coracle/last_checked/v1']], 'opaque');
    expect(op.verbPhrase).toBe('sync coracle data with your account');
  });

  it('falls back to the bounded d value', () => {
    const op = appDataOperationFor([['d', 'my-app-settings']], 'not json');
    expect(op.verbPhrase).toBe("sync app data ('my-app-settings') with your account");
  });

  it('falls back to the catalog default with no d tag at all', () => {
    const op = appDataOperationFor([], '');
    expect(op.verbPhrase).toBe('store app settings under your identity');
  });

  it('bounds hostile-length operation names and descriptions', () => {
    const longOp = appDataOperationFor(PRIMAL_D(`get_${'x'.repeat(4096)}`), '{}');
    expect(longOp.headline.length).toBeLessThan(120);
    expect(longOp.verbPhrase.length).toBeLessThan(120);

    const longDescription = appDataOperationFor(
      [['d', 'SomeApp']],
      JSON.stringify({ description: 'y'.repeat(4096) })
    );
    expect(longDescription.verbPhrase.length).toBeLessThan(120);
  });
});
