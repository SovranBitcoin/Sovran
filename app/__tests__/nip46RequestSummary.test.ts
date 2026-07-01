/**
 * Pins the request-summary layer: human-readable headlines/bodies/activity
 * lines for the real request shapes Primal Web sends (captured live), the
 * NIP-10 reply-detection matrix, follow-list diffing, zap conversion,
 * never-sign anomalies, hostile-length bounding, and the total generic
 * fallback that keeps unknown kinds on the catalog path.
 */

import {
  summarizeRequest,
  type RequestSummary,
  type SummarizeRequestInput,
} from '@/features/nostrSigner/lib/requestSummary';
import type { UnsignedEvent } from '@/features/nostrSigner/lib/nip46Types';

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const HEX_C = 'c'.repeat(64);
const HEX_D = 'd'.repeat(64);

function signEvent(event: Partial<UnsignedEvent> & { kind: number }): SummarizeRequestInput {
  const unsigned: UnsignedEvent = {
    content: '',
    tags: [],
    created_at: 1_781_087_003,
    ...event,
  };
  return {
    method: 'sign_event',
    kind: unsigned.kind,
    preview: { type: 'sign_event', event: unsigned },
  };
}

function bodyText(summary: RequestSummary, appName = 'Primal Web'): string {
  return (summary.body?.({ appName }) ?? []).map((segment) => segment.text).join('');
}

describe('kind 7 reactions', () => {
  // Live Primal payload: like with e/p/client tags.
  const like = signEvent({
    kind: 7,
    content: '+',
    tags: [
      ['e', '209df967e7639928cc31d79efa4382183994d4809fda09b8db6439960be44e34'],
      ['p', '6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93'],
      ['client', 'Primal Web'],
    ],
  });

  it('summarizes a "+" as a like with the reacted note referenced', () => {
    const summary = summarizeRequest(like);
    expect(summary.headline).toBe('Like a Post');
    expect(bodyText(summary)).toBe('Primal Web wants to like a post as you.');
    expect(summary.detail).toMatchObject({
      type: 'react',
      reaction: { kind: 'like' },
      targetEventId: '209df967e7639928cc31d79efa4382183994d4809fda09b8db6439960be44e34',
      targetAuthorPubkey: '6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93',
    });
    expect(summary.referenced.noteIds).toEqual([
      '209df967e7639928cc31d79efa4382183994d4809fda09b8db6439960be44e34',
    ]);
    expect(summary.activityLine).toBe('Liked a post');
  });

  it('treats empty content as a like and "-" as a dislike', () => {
    expect(summarizeRequest(signEvent({ kind: 7, content: '' })).headline).toBe('Like a Post');
    const dislike = summarizeRequest(signEvent({ kind: 7, content: '-' }));
    expect(dislike.headline).toBe('Dislike a Post');
    expect(dislike.activityLine).toBe('Disliked a post');
  });

  it('renders emoji reactions bounded', () => {
    const emoji = summarizeRequest(signEvent({ kind: 7, content: '🔥' }));
    expect(emoji.headline).toBe('React to a Post');
    expect(emoji.detail).toMatchObject({ reaction: { kind: 'emoji', emoji: '🔥' } });

    const hostile = summarizeRequest(signEvent({ kind: 7, content: 'x'.repeat(500) }));
    expect(
      (hostile.detail as { reaction: { emoji: string } }).reaction.emoji.length
    ).toBeLessThanOrEqual(8);
  });

  it('uses the LAST e/p tags per NIP-25', () => {
    const summary = summarizeRequest(
      signEvent({
        kind: 7,
        content: '+',
        tags: [
          ['e', HEX_A],
          ['e', HEX_B],
          ['p', HEX_C],
          ['p', HEX_D],
        ],
      })
    );
    expect(summary.detail).toMatchObject({ targetEventId: HEX_B, targetAuthorPubkey: HEX_D });
  });
});

describe('kind 6 reposts', () => {
  // Live Primal payload: content is the stringified reposted kind-1 event.
  const embeddedNote = {
    id: '5409264e41da6294842e0977ff769e26112c12a7268483cdce104c1048f9cca4',
    pubkey: '787338757fc25d65cd929394d5e7713cf43638e8d259e8dcf5c73b834eb851f2',
    created_at: 1781074784,
    kind: 1,
    tags: [['r', 'wss://nos.lol/']],
    content:
      'OpenSats has supported many projects for multiple years. Most projects accept donations directly, and we encourage everyone to support them whenever possible.',
    sig: 'de78d48f9fd0e997781ae7a18ce5bf838374eecccfdf6e0d9029bbb0281bc03b',
  };

  it('renders the embedded note instantly with no fetch needed', () => {
    const summary = summarizeRequest(
      signEvent({
        kind: 6,
        content: JSON.stringify(embeddedNote),
        tags: [
          ['e', embeddedNote.id],
          ['p', embeddedNote.pubkey],
        ],
      })
    );
    expect(summary.headline).toBe('Repost a Note');
    expect(summary.detail).toMatchObject({
      type: 'repost',
      embedded: { pubkey: embeddedNote.pubkey },
    });
    const embedded = (summary.detail as { embedded: { text: string } }).embedded;
    expect(embedded.text).toContain('OpenSats has supported');
    expect(embedded.text.length).toBeLessThanOrEqual(300);
    // Embedded content present → nothing to fetch beyond the author profile.
    expect(summary.referenced.noteIds).toEqual([]);
    expect(summary.referenced.pubkeys).toEqual([embeddedNote.pubkey]);
  });

  it('falls back to the e tag when the content JSON is malformed', () => {
    const summary = summarizeRequest(
      signEvent({ kind: 6, content: 'not json {', tags: [['e', HEX_A]] })
    );
    expect(summary.detail).toMatchObject({ type: 'repost', targetEventId: HEX_A });
    expect((summary.detail as { embedded?: unknown }).embedded).toBeUndefined();
    expect(summary.referenced.noteIds).toEqual([HEX_A]);
  });
});

describe('kind 3 follow diff', () => {
  const followTags = (pubkeys: string[]): string[][] => pubkeys.map((pk) => ['p', pk]);

  it('shows the single new follow against the current baseline', () => {
    const summary = summarizeRequest(
      signEvent({ kind: 3, tags: followTags([HEX_A, HEX_B, HEX_C]) }),
      {
        currentFollows: new Set([HEX_A, HEX_B]),
      }
    );
    expect(summary.headline).toBe('Follow a New Account');
    expect(bodyText(summary)).toBe('Primal Web wants to follow a new account as you.');
    expect(summary.detail).toMatchObject({
      type: 'follow_diff',
      added: [HEX_C],
      removed: [],
      total: 3,
      baseline: 'available',
    });
    expect(summary.referenced.pubkeys).toEqual([HEX_C]);
    expect(summary.activityLine).toBe('Followed a new account');
  });

  it('detects a single unfollow', () => {
    const summary = summarizeRequest(signEvent({ kind: 3, tags: followTags([HEX_A]) }), {
      currentFollows: new Set([HEX_A, HEX_B]),
    });
    expect(summary.headline).toBe('Unfollow an Account');
    expect(summary.detail).toMatchObject({ added: [], removed: [HEX_B] });
  });

  it('caps the displayed diff at 10 while keeping full counts', () => {
    const added = Array.from(
      { length: 25 },
      (_, i) => `${i.toString(16).padStart(2, '0')}${'0'.repeat(62)}`
    );
    const summary = summarizeRequest(signEvent({ kind: 3, tags: followTags(added) }), {
      currentFollows: new Set<string>(),
    });
    const detail = summary.detail as { added: string[]; addedCount: number };
    expect(detail.added).toHaveLength(10);
    expect(detail.addedCount).toBe(25);
    expect(summary.referenced.pubkeys).toHaveLength(10);
  });

  it('falls back to the full-list-replace warning without a baseline', () => {
    const summary = summarizeRequest(signEvent({ kind: 3, tags: followTags([HEX_A, HEX_B]) }));
    expect(summary.detail).toMatchObject({ baseline: 'unavailable', total: 2 });
    expect(summary.riskFlags).toContain('full_list_replace');
    expect(bodyText(summary)).toBe(
      'Primal Web wants to replace your entire follow list with 2 accounts.'
    );
  });

  it('ignores malformed p tags', () => {
    const summary = summarizeRequest(
      signEvent({
        kind: 3,
        tags: [
          ['p', 'nothex'],
          ['p', HEX_A],
        ],
      }),
      { currentFollows: new Set<string>() }
    );
    expect((summary.detail as { total: number }).total).toBe(1);
  });
});

describe('kind 1 NIP-10 reply detection', () => {
  it('plain post with no e/q tags', () => {
    const summary = summarizeRequest(signEvent({ kind: 1, content: 'hello world' }));
    expect(summary.headline).toBe('Publish a Post');
    expect(summary.detail).toMatchObject({ type: 'post', text: 'hello world' });
    expect(summary.referenced.noteIds).toEqual([]);
  });

  it('marked reply beats root', () => {
    const summary = summarizeRequest(
      signEvent({
        kind: 1,
        content: 'my reply',
        tags: [
          ['e', HEX_A, '', 'root'],
          ['e', HEX_B, '', 'reply'],
        ],
      })
    );
    expect(summary.headline).toBe('Reply to a Post');
    expect(summary.detail).toMatchObject({ type: 'reply', parentEventId: HEX_B, text: 'my reply' });
    expect(summary.referenced.noteIds).toEqual([HEX_B]);
  });

  it('lone root marker means replying to the root', () => {
    const summary = summarizeRequest(
      signEvent({ kind: 1, content: 'top-level reply', tags: [['e', HEX_A, '', 'root']] })
    );
    expect(summary.detail).toMatchObject({ type: 'reply', parentEventId: HEX_A });
  });

  it('deprecated positional scheme: last unmarked e tag is the parent', () => {
    const summary = summarizeRequest(
      signEvent({
        kind: 1,
        content: 'old client',
        tags: [
          ['e', HEX_A],
          ['e', HEX_B],
        ],
      })
    );
    expect(summary.detail).toMatchObject({ type: 'reply', parentEventId: HEX_B });
  });

  it('mention-only e tags do not make a reply; q tag makes a quote', () => {
    const summary = summarizeRequest(
      signEvent({
        kind: 1,
        content: 'check this out',
        tags: [
          ['e', HEX_A, '', 'mention'],
          ['q', HEX_B],
        ],
      })
    );
    expect(summary.headline).toBe('Quote a Post');
    expect(summary.detail).toMatchObject({ type: 'quote', quotedEventId: HEX_B });
  });

  it('bounds hostile-length reply text', () => {
    const summary = summarizeRequest(
      signEvent({ kind: 1, content: 'z'.repeat(10_000), tags: [['e', HEX_A, '', 'reply']] })
    );
    expect((summary.detail as { text: string }).text.length).toBeLessThanOrEqual(300);
  });
});

describe('kind 30078 app data (live Primal payloads)', () => {
  it('get_app_settings reads as loading settings', () => {
    const summary = summarizeRequest(
      signEvent({
        kind: 30078,
        content: '{ "description": "Sync app settings" }',
        tags: [
          ['d', 'Primal-Web App', 'get_app_settings'],
          ['client', 'Primal Web'],
        ],
      })
    );
    expect(summary.headline).toBe('Load App Settings');
    expect(bodyText(summary)).toBe('Primal Web wants to load app settings.');
    expect(summary.activityLine).toBe('Load app settings');
  });

  it('nwc subsettings escalate with the wallet_credential flag', () => {
    const summary = summarizeRequest(
      signEvent({
        kind: 30078,
        content: '{"subkey":"user-nwc"}',
        tags: [['d', 'Primal-Web App', 'get_app_subsettings_nwc']],
      })
    );
    expect(summary.riskFlags).toContain('wallet_credential');
  });

  it('reset_direct_message_count reads as marking messages read', () => {
    const summary = summarizeRequest(
      signEvent({
        kind: 30078,
        content:
          '{ "description": "reset messages from \'d34e832d42ad8b93c1a1c3c8400934405f30bcbf857f39ea2f008c26383f78d0\'"}',
        tags: [['d', 'Primal-Web App', 'reset_direct_message_count']],
      })
    );
    expect(summary.headline).toBe('Reset Direct Message Count');
  });
});

describe('kind 9734 zap requests', () => {
  it('converts millisats to sats and flags financial', () => {
    const summary = summarizeRequest(
      signEvent({
        kind: 9734,
        tags: [
          ['amount', '21000'],
          ['p', HEX_A],
        ],
      })
    );
    expect(summary.headline).toBe('Approve a Zap Request');
    expect(summary.detail).toMatchObject({
      type: 'zap_request',
      amountSats: 21,
      recipientPubkey: HEX_A,
    });
    expect(summary.riskFlags).toEqual(['financial']);
    expect(summary.activityLine).toBe('Requested a 21 sat zap');
  });

  it('rejects malformed and absurd amounts', () => {
    for (const amount of ['-5', 'abc', '1.5', String(10 ** 16)]) {
      const summary = summarizeRequest(signEvent({ kind: 9734, tags: [['amount', amount]] }));
      expect((summary.detail as { amountSats?: number }).amountSats).toBeUndefined();
    }
  });
});

describe('other kinds', () => {
  it('kind 5 deletions list bounded targets', () => {
    const summary = summarizeRequest(
      signEvent({
        kind: 5,
        tags: [
          ['e', HEX_A],
          ['a', `30023:${HEX_B}:slug`],
        ],
      })
    );
    expect(summary.detail).toMatchObject({ type: 'delete', targetEventIds: [HEX_A] });
    expect(summary.activityLine).toBe('Requested deletion of 2 events');
  });

  it('kind 27235 login extracts the u tag target', () => {
    const summary = summarizeRequest(
      signEvent({
        kind: 27235,
        tags: [
          ['u', 'https://blossom.primal.net/upload'],
          ['method', 'POST'],
        ],
      })
    );
    expect(summary.detail).toMatchObject({
      type: 'login',
      target: 'https://blossom.primal.net/upload',
    });
    // Catalog body (relayLabel-aware) stays in charge for login copy.
    expect(summary.body).toBeUndefined();
  });

  it('kind 30023 articles surface the title', () => {
    const summary = summarizeRequest(signEvent({ kind: 30023, tags: [['title', 'My Article']] }));
    expect(summary.headline).toBe('Publish an Article');
    expect(summary.activityLine).toBe('Published article "My Article"');
  });

  it('never-sign kinds are flagged as anomalies', () => {
    for (const kind of [14, 15, 1059, 9735, 13194, 23195]) {
      const summary = summarizeRequest(signEvent({ kind }));
      expect(summary.riskFlags).toContain('never_sign_anomaly');
      expect(summary.headline).toBe('Unusual Signing Request');
    }
  });

  it('unknown kinds fall back to generic (catalog renders verbatim)', () => {
    const summary = summarizeRequest(signEvent({ kind: 23456 }));
    expect(summary.detail).toEqual({ type: 'generic' });
    expect(summary.headline).toBeUndefined();
    expect(summary.body).toBeUndefined();
  });

  it('wallet kinds stay generic so the catalog wallet row renders', () => {
    expect(summarizeRequest(signEvent({ kind: 17375 })).detail).toEqual({ type: 'generic' });
  });
});

describe('encrypt/decrypt previews', () => {
  it('decrypt names the conversation peer in the body', () => {
    const summary = summarizeRequest({
      method: 'nip44_decrypt',
      preview: { type: 'decrypt', peerPubkey: HEX_A, ciphertextLength: 256 },
    });
    expect(summary.detail).toMatchObject({ type: 'decrypt', peerPubkey: HEX_A });
    expect(summary.referenced.pubkeys).toEqual([HEX_A]);
    const text = (summary.body?.({ appName: 'Primal Web', peerLabel: 'alice' }) ?? [])
      .map((segment) => segment.text)
      .join('');
    expect(text).toBe('Primal Web wants to read your encrypted conversation with alice.');
  });

  it('encrypt stays on catalog copy but references the peer', () => {
    const summary = summarizeRequest({
      method: 'nip44_encrypt',
      preview: { type: 'encrypt', peerPubkey: HEX_B, plaintext: 'hi' },
    });
    expect(summary.body).toBeUndefined();
    expect(summary.referenced.pubkeys).toEqual([HEX_B]);
  });

  it('none previews are generic', () => {
    const summary = summarizeRequest({ method: 'ping', preview: { type: 'none' } });
    expect(summary.detail).toEqual({ type: 'generic' });
  });
});
