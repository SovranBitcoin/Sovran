import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { siteCopy } from '../../copy/src/site';

// Migration baseline: sovran.money/src/content/roadmap.ts, reviewed 2026-09-15.
// Git blob: 01a64151ec67aab218fa4d2742eb2b2c97d97309 (clean source worktree).
// Public page: https://sovran.money/en/roadmap
// The source had group slugs but no item IDs. IDs below freeze each original
// group slug + two-digit, 1-based bullet position. Do not regenerate this table
// from siteCopy: it independently pins every original item and its status.
// Each row contains an exact source excerpt for audit and key details that must
// survive the newcomer rewrite. Wording checks supplement, not replace, review.
// No sibling checkout or network is needed to run these tests.
const sourceItems = [
  ['payments-01', 'complete', 'Scan, paste, or tap to pay:', ['Scan, paste, or tap', 'Bitcoin', 'Lightning', 'Cashu', 'sovran:/cashu:', 'payment screen']],
  ['payments-02', 'complete', 'Hold and read balances in sats, dollars, pounds, and euros', ['sats', 'dollars', 'pounds', 'euros', 'selectors', 'history']],
  ['payments-03', 'complete', "Send Cashu ecash P2PK-locked to a recipient's Nostr npub", ['ecash', 'Nostr', 'npub', 'P2PK', 'matching key', 'copied token']],
  ['payments-04', 'planned', 'Parse all spending conditions on locked tokens', ['every spending condition', 'locktime', 'reclaim', 'rollback']],
  ['payments-05', 'complete', 'Offline sends stay predictable:', ['mint is unreachable', 'proofs', 'round-up', 'round-down', 'Stop an offline send cleanly']],
  ['payments-06', 'complete', 'Every payment shows who it is for, with name, avatar, and live Nostr profile', ['name', 'avatar', 'live Nostr profile', 'before money moves']],
  ['payments-07', 'in-progress', 'Memos that stay attached:', ['history', 'receipts', 'Lightning receives already', 'ecash, on-chain, payment-request, nearby, and chat sends']],
  ['payments-08', 'planned', 'One receive-screen settings panel to toggle P2PK, enable BOLT-12, and edit your npub.cash username', ['one panel', 'P2PK', 'BOLT-12', 'npub.cash username', 'onboarding']],
  ['payments-09', 'planned', 'Align the mint picker on the amount screens', ['Align the mint picker', 'amount screens', 'pixels too high']],
  ['payments-10', 'planned', "Pay from another mint when the first one can't:", ['another mint', 'same Lightning invoice', 'cannot cover', 'payment fails']],
  ['payments-11', 'planned', 'Try every way a code offers to pay before giving up:', ['BIP-321', 'ecash, Lightning, or on-chain', 'next supported option', 'failed NFC tap']],
  ['payments-12', 'planned', 'Change the mint right at the Pay confirmation', ['change mints', 'Pay confirmation', 'picker is dismissed', 'ask again']],
  ['payments-13', 'planned', 'Address hallmarks:', ['address hallmarks', 'visual stamps', 'scanned code', 'shown on your phone']],
  ['payments-14', 'planned', "Respect a Lightning address's own limits:", ['minimum and maximum', 'Lightning address', 'amount entry', 'limits']],
  ['payment-requests-01', 'complete', 'Pay a NUT-18 request from scan, paste, chat, or an app link:', ['NUT-18', 'scan, paste, chat, or an app link', 'review step', 'trusted mints', 'gift-wrapped', 'NIP-17']],
  ['payment-requests-02', 'planned', 'Create your own payment requests', ['generate, cancel, recover, and deliver', 'Nostr', 'ask for money']],
  ['mints-01', 'complete', 'Vet a mint before you trust it:', ['operator', 'Nostr reviews', 'star rating', 'live audit data', 'swap success rate', 'verify mode', 'accept or reject']],
  ['mints-02', 'planned', 'Leave your own review:', ['Rate a mint', 'short review', 'Publish it to Nostr', 'ratings and reviews']],
  ['mints-03', 'planned', 'Adding mints shows live progress instead of a blank wait:', ['each mint', 'connects, resolves, and verifies', 'success, retry, and failure', 'several mints']],
  ['mints-04', 'planned', 'Decline a mint without leaving the money behind:', ['reject', 'redeem its proofs directly', 'mint you trust', 'melt', 'Retry across', 'already-failed choices disabled']],
  ['mints-05', 'planned', 'Batch Nut Drop group payouts and repeat minting', ['Batch Nut Drop', 'repeated minting', 'one action', 'every token']],
  ['wallet-recovery-01', 'complete', 'One recovery phrase backs up every profile and its wallet at once', ['one recovery phrase', 'profiles and wallets', 'separate keys', 'own path']],
  ['wallet-recovery-02', 'complete', 'The wallet runs on the Coco engine:', ['Coco engine', 'faster restores', 'live balances', 'websocket', 'on-chain']],
  ['wallet-recovery-03', 'in-progress', 'Setup, restore, and moving to a new phone are being reshaped to feel seedless', ['setup, restore, and moving', 'seedless', 'recovery phrase by hand']],
  ['wallet-recovery-04', 'planned', 'Profiles added by pasting an existing nsec will come back on their own after a reinstall', ['imported', 'nsec', 'reinstall', 'import each key again']],
  ['wallet-recovery-05', 'planned', 'When a restored wallet adds a mint, Coco re-checks it for funds', ['restored wallet adds a mint', 'Coco re-check', 'first restore pass']],
  ['wallet-recovery-06', 'planned', 'Switching profiles stays solid:', ['timing race', 'crash', 'switching profiles more than once', 'restart']],
  ['wallet-engine-01', 'complete', 'Multi-currency amounts run end to end:', ['sats, USD, EUR, and GBP', 'balances, fees, and history', 'each currency', 'recovery phrase']],
  ['wallet-engine-02', 'complete', 'Quote-first operations track each invoice or offer as its own record', ['invoice or offer', 'quote', 'pending Lightning top-up', 'mint issues ecash proofs', 'survive an app restart']],
  ['wallet-engine-03', 'complete', "History is a live timeline read straight from Coco's wallet-core state:", ["Coco's wallet-core state", 'actual operation', 'reopen', 'original token']],
  ['wallet-engine-04', 'in-progress', 'Websocket watchers keep mint and balance state current while the app is open.', ['mint and balance', 'websocket watchers', 'Pause', 'background', 'battery']],
  ['wallet-engine-05', 'in-progress', 'Proof-state recovery is being tightened', ['checking ecash', 'sweeping', 'rolling back', 'stuck funds', 'invalid tokens', 'exact for each currency']],
  ['wallet-engine-06', 'planned', 'Tell a down mint apart from a down phone:', ['unreachable mint', 'offline phone', 'name the mint as the cause', 'any send error', 'usable local proofs']],
  ['wallet-engine-07', 'planned', 'Fee-aware fiat amounts:', ['dollars, pounds, and euros', 'lowest fees', 'rounding window', 'affordable amount', 'same fiat value', 'without an extra prompt']],
  ['onchain-lightning-01', 'in-progress', 'Make onchain receive and send first-class:', ['BIP-321', 'clear amounts', 'selectable fees', 'plain-language warnings', 'cannot yet issue ecash from a deposit', 'send is not supported yet', 'Coco']],
  ['onchain-lightning-02', 'planned', 'Handle onchain-to-onchain transfers on the same mint as a special case', ['on-chain-to-on-chain', 'same mint', 'immediate', 'confirmation', 'timeline or history']],
  ['onchain-lightning-03', 'in-progress', 'Replace throwaway deposit addresses with reusable onchain mints in Coco:', ['reusable on-chain minting', 'Coco', 'same address repeatedly', 'track its balance', 'claim deposits automatically', 'partial withdrawals']],
  ['onchain-lightning-04', 'in-progress', "Wire Coco's onchain melt into the send and history screens", ['melt', 'send and history', 'selectable fee rates', 'live settlement progress', 'failure states']],
  ['onchain-lightning-05', 'planned', 'Add reusable Lightning offers (BOLT-12) for sending and receiving', ['BOLT-12', 'sending and receiving', 'static code', 'repeated payments', 'engine and release pipeline']],
  ['onchain-lightning-06', 'planned', 'Bring Payjoin to onchain sends:', ['Payjoin', 'on-chain sends', 'everyday payments', 'collaborative transactions', 'save fees', 'chain-analysis']],
  ['social-feed-01', 'in-progress', 'The home feed ranks Nostr notes for relevance over raw recency', ['relevance', 'recency', 'reply chains', 'reposts, zaps', 'post metrics', 'unified search', 'grouped notifications', 'ranking, threading, and notification quality']],
  ['social-feed-02', 'planned', 'Add a composer to the thread view', ['reply composer', 'thread view', 'nested under its parent']],
  ['social-feed-03', 'planned', 'Add a mirror-to-X feature', ['connected X account', 'mirror', 'opt-in share', 'managed posting later']],
  ['social-feed-04', 'planned', 'Make Nagg media-aware:', ['Nagg', 'image and video dimensions', 'aspect ratios', 'safe layout metadata', 'reserve space', 'filter or downrank']],
  ['social-feed-05', 'planned', 'Move link preview images into Nagg:', ['Nagg fetch and cache', 'Open Graph preview image', 'feed response', 'metadata separately']],
  ['notifications-01', 'in-progress', 'Notification policies (Relaxed, Moderate, Strict, Follows) and a Direct/Thread reply scope', ['Relaxed, Moderate, Strict, and Follows', 'Direct/Thread', 'adaptive ranking', 'opening or replying', 'never answer', 'without needing to block']],
  ['notifications-02', 'in-progress', 'The Notifications App tab ships today as a static welcome card.', ['Notifications App tab', 'static welcome card', 'release notes', 'live mint status']],
  ['messaging-01', 'complete', 'Pay from the chat composer:', ['chat composer', 'Lightning address', 'without leaving the thread', 'inline card', 'tap to redeem']],
  ['messaging-02', 'in-progress', 'Extend encryption past two-party threads into private group chats.', ['private multi-member groups', 'opt-in MLS-encrypted', 'Marmot', 'two-party', 'remaining work']],
  ['identity-01', 'complete', 'Receiving feels like sharing a username, not a protocol address:', ['each profile', 'npub.cash Lightning address', 'Nostr key', 'one-tap copy', 'receive screen', 'free names']],
  ['identity-02', 'planned', 'Add the npub.cash address as a LUD on the Nostr profile', ['npub.cash', 'LUD', 'Nostr profile', 'zaps', 'not only the receive screen']],
  ['identity-03', 'planned', 'Resolve who zapped your npub.cash address:', ['npub.cash', 'incoming Lightning address payment', 'Nostr name and avatar', 'history when available', 'generic mint receive']],
  ['identity-04', 'planned', 'Tag your profile with a group, event, or community', ['group, event, or community', 'meetup or cohort', 'share a feed', 'suggested follows']],
  ['history-insights-01', 'complete', 'Payment history reads as a live timeline:', ['QR, NFC, clipboard, or deep link', 'how money moved', 'how it settled', 'Group by date', 'month tabs', 'pinned', 'richer recipient and originating-request context']],
  ['history-insights-02', 'in-progress', 'The wallet screen already charts spent and received for the current month', ['current-month spending and receipts', 'projected trend line', 'past months', 'running totals', 'mint or currency']],
  ['ai-01', 'in-progress', 'Let AI draw from your wallet balance instead of a separate Routstr account', ['wallet balance', 'separate Routstr balance', 'streams OpenAI, Claude, and Grok', 'ecash', 'token top-up', 'combining the balances']],
  ['ai-02', 'planned', 'Offer opt-in AI-drafted replies', ['opt-in AI-drafted replies', 'confirming every send', 'not send a reply or move money on its own']],
  ['open-stack-01', 'complete', 'The app and every library behind it are public on GitHub', ['app and its supporting libraries public on GitHub', 'reading, auditing, and reuse', 'respective licenses']],
  ['open-stack-02', 'in-progress', 'Packaging the search, notification, and feed recipes that power Sovran into nagg-ts', ['search, notification, and feed recipes', 'nagg-ts', 'Nostr client', 'without adopting a particular user interface']],
  ['open-stack-03', 'in-progress', 'Documenting how Colada parses, routes, and sequences payments over the Coco engine', ['Colada parses, routes, and sequences', 'Coco', 'ecash and Lightning first and on-chain next', 'other wallets']],
  ['open-stack-04', 'planned', 'Spanish first, then a repeatable translation workflow and regular public progress notes', ['Spanish first', 'repeatable translation workflow', 'regular public progress notes']],
  ['releases-quality-01', 'in-progress', 'Fold the scattered build, submit, and AltStore sideload scripts into one release command', ['build, submit, and AltStore sideload', 'one release command', 'App Store, sideloadable iOS, and Android APK', 'in sync']],
  ['releases-quality-02', 'in-progress', 'Grow the Maestro send, receive, and onboarding suites', ['Maestro send, receive, and onboarding', 'iPhones', 'Android builds', 'operating-system versions', 'NFC tap-to-pay', 'manual checks']],
  ['releases-quality-03', 'planned', 'Trim the bundle down from its 94 MB TestFlight footprint', ['original roadmap baseline of 94 MB on TestFlight', 'installs, updates, and cold starts']],
] as const;

const roadmap = siteCopy.roadmap;
const items = roadmap.groups.flatMap(group => group.items.map(item => ({ ...item, sourceGroup: group.id })));

test('all 64 original ideas remain separate in their 14 source groups, without a new schedule', () => {
  expect(roadmap.groups.map(group => group.id)).toEqual([
    'payments', 'payment-requests', 'mints', 'wallet-recovery', 'wallet-engine',
    'onchain-lightning', 'social-feed', 'notifications', 'messaging', 'identity',
    'history-insights', 'ai', 'open-stack', 'releases-quality',
  ]);
  expect(sourceItems).toHaveLength(64);
  expect(items).toHaveLength(64);
  expect(new Set(items.map(item => item.id)).size).toBe(64);
  expect(items.map(item => item.id).sort()).toEqual(sourceItems.map(([id]) => id).sort());
  // Every original group remained in progress, even when some bullets were done.
  for (const group of roadmap.groups) expect(group.status).toBe('in-progress');
  expect(items.filter(item => item.status === 'complete')).toHaveLength(16);
  expect(items.filter(item => item.status === 'in-progress')).toHaveLength(17);
  expect(items.filter(item => item.status === 'planned')).toHaveLength(31);
});

for (const [id, status, sourceExcerpt, requiredDetails] of sourceItems) {
  test(`${id}: ${sourceExcerpt}`, () => {
    const item = items.find(item => item.id === id);
    expect(item).toBeDefined();
    expect(item!.sourceGroup).toBe(id.replace(/-\d{2}$/, ''));
    expect(item!.status).toBe(status);
    for (const detail of requiredDetails) expect(item!.text.toLowerCase()).toContain(detail.toLowerCase());
  });
}

test('recurring loading polish retains its source slug and cadence, not a completion status', () => {
  // Original recurringEntries[0]: "Smooth loading, no jumps", "Every release".
  // Source excerpts: "Keep screens steady as data loads"; "better empty and
  // error states, and placeholders".
  expect(roadmap.recurring.items).toHaveLength(1);
  const [item] = roadmap.recurring.items;
  expect(item.id).toBe('interface-stability-loading-polish');
  expect(item.title).toBe('Smooth loading, no jumps');
  expect(item.cadence).toBe('Every release');
  expect(item).not.toHaveProperty('status');
  for (const detail of ['steady', 'content jumps', 'empty and error states', 'placeholders']) {
    expect(item.text).toContain(detail);
  }
});

test('roadmap renders every item with its stable anchor, source group and plain inline status', () => {
  const page = readFileSync(new URL('../src/pages/roadmap.astro', import.meta.url), 'utf8');
  expect(page).toContain('copy.groups.map(');
  expect(page).toContain('group.items.map(');
  expect(page).toContain('id={item.id} data-source-group={group.id}');
  expect(page).toContain('copy.statusLabels[group.status]');
  expect(page).toContain('<span class="status">{copy.statusLabels[item.status]}.</span> {item.text}');
  expect(page).toContain('copy.recurring.items.map(');
  expect(page).toContain('{item.cadence}');
  expect(page).not.toContain('href={copy.source.href}'); // The archival repository is private.
  expect(page).not.toMatch(/\.slice\(|\.filter\(|<details\b|<summary\b|<script\b|client:|line-clamp|overflow:\s*hidden/);
});
