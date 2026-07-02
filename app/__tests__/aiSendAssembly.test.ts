/**
 * Pins the multimodal request-assembly contract shared by `useAiSend`'s
 * send and retry flows (`assembleApiMessages` is the ONE assembly seam, so
 * testing it pins both), the routstrStore persistence tolerance for the
 * new attachment/lineup fields, and the vision-aware candidate filter's
 * building blocks in `format.ts`.
 */
import {
  measureMessageContent,
  type RoutstrChatMessage,
  type RoutstrModel,
} from '@/shared/lib/routstr/api';
import type { ChatAttachment, RoutstrMessage } from '@/shared/stores/profile/routstrStore';
import {
  MAX_INLINE_IMAGES,
  MAX_INLINE_IMAGE_TURNS,
  assembleApiMessages,
  stripImageParts,
} from '@/features/ai/lib/assembleApiMessages';
import {
  entryForSlot,
  estimateTurnCostSatsFromPricing,
  resolveCandidateEntries,
  resolveSelectedEntry,
} from '@/features/ai/lib/format';
import { deriveLineup } from '@/shared/lib/routstr/lineup';
import fixture from './fixtures/routstr-models.fixture.json';

const att = (n: number): ChatAttachment => ({
  localUri: `file:///photos/img-${n}.jpg`,
  mimeType: 'image/jpeg',
  width: 100,
  height: 100,
});

const msg = (
  id: string,
  role: 'user' | 'assistant',
  content: string,
  attachments?: ChatAttachment[]
): RoutstrMessage => ({ id, role, content, timestamp: 1, attachments });

/** Encoder stub: data-URL derived from the URI; records call counts. */
function makeEncoder(missing: Set<string> = new Set()) {
  const calls = new Map<string, number>();
  const encode = async (attachment: ChatAttachment) => {
    calls.set(attachment.localUri, (calls.get(attachment.localUri) ?? 0) + 1);
    if (missing.has(attachment.localUri)) return null;
    return `data:image/jpeg;base64,${attachment.localUri}`;
  };
  return { encode, calls };
}

const imageParts = (m: RoutstrChatMessage): number =>
  typeof m.content === 'string' ? 0 : m.content.filter((p) => p.type === 'image_url').length;

describe('assembleApiMessages', () => {
  it('keeps text-only turns as plain string content (pre-image wire shape unchanged)', async () => {
    const { encode } = makeEncoder();
    const { messages, imageCount } = await assembleApiMessages(
      [msg('u1', 'user', 'hi'), msg('a1', 'assistant', 'hello'), msg('u2', 'user', 'ok')],
      encode
    );
    expect(imageCount).toBe(0);
    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'ok' },
    ]);
  });

  it('expands attachment turns into text + image_url content parts', async () => {
    const { encode } = makeEncoder();
    const { messages, imageCount } = await assembleApiMessages(
      [msg('u1', 'user', 'what is this?', [att(1), att(2)])],
      encode
    );
    expect(imageCount).toBe(2);
    expect(messages[0].content).toEqual([
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${att(1).localUri}` } },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${att(2).localUri}` } },
    ]);
  });

  it(`inlines images only from the newest ${MAX_INLINE_IMAGE_TURNS} attachment turns; older image turns assemble text-only`, async () => {
    const { encode, calls } = makeEncoder();
    const path = [
      msg('u1', 'user', 'first', [att(1)]),
      msg('a1', 'assistant', 'r1'),
      msg('u2', 'user', 'second', [att(2)]),
      msg('a2', 'assistant', 'r2'),
      msg('u3', 'user', 'third', [att(3)]),
      msg('a3', 'assistant', 'r3'),
    ];
    const { messages, imageCount } = await assembleApiMessages(path, encode);
    expect(imageCount).toBe(2);
    expect(messages[0]).toEqual({ role: 'user', content: 'first' }); // outside the window
    expect(imageParts(messages[2])).toBe(1);
    expect(imageParts(messages[4])).toBe(1);
    // The windowed-out attachment is never even read from disk.
    expect(calls.has(att(1).localUri)).toBe(false);
  });

  it(`caps inline images at ${MAX_INLINE_IMAGES} per request, newest turns first`, async () => {
    const { encode } = makeEncoder();
    const path = [
      msg('u1', 'user', 'many', [att(1), att(2), att(3)]),
      msg('a1', 'assistant', 'r'),
      msg('u2', 'user', 'more', [att(4), att(5), att(6)]),
    ];
    const { messages, imageCount } = await assembleApiMessages(path, encode);
    expect(imageCount).toBe(MAX_INLINE_IMAGES);
    expect(imageParts(messages[2])).toBe(3); // newest turn gets its full set
    expect(imageParts(messages[0])).toBe(1); // older turn gets the remainder
  });

  it('degrades a missing/expired local URI to text-only with the other images intact', async () => {
    const { encode } = makeEncoder(new Set([att(1).localUri]));
    const { messages, imageCount } = await assembleApiMessages(
      [msg('u1', 'user', 'broken + ok', [att(1), att(2)])],
      encode
    );
    expect(imageCount).toBe(1);
    expect(imageParts(messages[0])).toBe(1);
    // The text part survives regardless.
    expect((messages[0].content as { type: string }[])[0]).toEqual({
      type: 'text',
      text: 'broken + ok',
    });
  });

  it('send/retry parity is structural: identical path in → identical wire messages out', async () => {
    const path = [msg('u1', 'user', 'q', [att(1)]), msg('a1', 'assistant', 'r')];
    const a = await assembleApiMessages(path, makeEncoder().encode);
    const b = await assembleApiMessages(path, makeEncoder().encode);
    expect(a).toEqual(b);
  });

  it('stripImageParts degrades a multimodal request to plain text (no-vision-candidate fallback)', async () => {
    const { encode } = makeEncoder();
    const { messages } = await assembleApiMessages(
      [msg('u1', 'user', 'look', [att(1), att(2)]), msg('a1', 'assistant', 'reply')],
      encode
    );
    const stripped = stripImageParts(messages);
    expect(stripped).toEqual([
      { role: 'user', content: 'look' },
      { role: 'assistant', content: 'reply' },
    ]);
    expect(measureMessageContent(stripped).imageParts).toBe(0);
  });

  it('measureMessageContent counts text chars + image parts without serialising payloads', async () => {
    const { encode } = makeEncoder();
    const { messages } = await assembleApiMessages(
      [msg('u1', 'user', '12345', [att(1)]), msg('a1', 'assistant', '678')],
      encode
    );
    expect(measureMessageContent(messages)).toEqual({ textChars: 8, imageParts: 1 });
  });
});

describe('vision-aware candidate resolution (format.ts over the derived lineup)', () => {
  const { lineup } = deriveLineup(fixture.data as unknown as RoutstrModel[]);

  it('resolves a (provider, tier) slot and returns null only when no lineup exists', () => {
    expect(resolveSelectedEntry('openai', 'auto', 1_000_000, lineup)?.modelId).toBe('gpt-5.5');
    expect(resolveSelectedEntry('openai', 'auto', 1_000_000, null)).toBeNull();
  });

  it('falls back across providers in the same tier before other tiers', () => {
    const chain = resolveCandidateEntries('claude', 'max', lineup);
    expect(chain[0]?.modelId).toBe(entryForSlot(lineup, 'claude', 'max')?.modelId);
    // Next candidates are the other providers' max cells, in provider order.
    expect(chain[1]?.modelId).toBe(entryForSlot(lineup, 'openai', 'max')?.modelId);
    expect(chain.length).toBe(12); // every filled cell exactly once
    expect(new Set(chain.map((e) => e.modelId)).size).toBe(12);
  });

  it('prefers the first affordable candidate, else the primary at any cost', () => {
    // Balance below every max_cost → primary comes back unaffordable-first.
    const broke = resolveSelectedEntry('claude', 'max', 0, lineup);
    expect(broke?.modelId).toBe(entryForSlot(lineup, 'claude', 'max')?.modelId);
    // A balance that can only afford the cheapest cells skips to them.
    const cheap = resolveSelectedEntry('openai', 'max', 700, lineup);
    expect(cheap).not.toBeNull();
    expect(cheap!.satsPricing.max_cost!).toBeLessThanOrEqual(700);
  });

  it('every selected entry carries visionInput so the send path can filter a chain with images', () => {
    const chain = resolveCandidateEntries('google', 'max', lineup);
    expect(chain.every((e) => typeof e.visionInput === 'boolean')).toBe(true);
    expect(chain.filter((e) => e.visionInput).length).toBeGreaterThan(0);
  });

  it('adds per-image fees into the turn estimate (Gemini undercount fix)', () => {
    const gemini = entryForSlot(lineup, 'google', 'max')!;
    const base = estimateTurnCostSatsFromPricing(gemini.satsPricing);
    const withImages = estimateTurnCostSatsFromPricing(gemini.satsPricing, 2);
    expect(base).not.toBeNull();
    expect(withImages!).toBeCloseTo(base! + gemini.satsPricing.image! * 2, 6);
    // Models without an image fee are unchanged.
    const noFee = estimateTurnCostSatsFromPricing({ ...gemini.satsPricing, image: null }, 2);
    expect(noFee).toBeCloseTo(base!, 6);
  });
});
