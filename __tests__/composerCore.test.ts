/**
 * Composer architectural core: rail-capability merge and block→kind:1
 * serialization (inline media urls + imeta + NIP-10/quote/CW tags).
 */
import { mergeRailCapabilities } from '@/features/composer/config/merge';
import type { RailCapability, ComposerBlock } from '@/features/composer/config/types';
import { buildNoteEvent } from '@/features/composer/publish/buildNoteEvent';

const nostrRail: RailCapability = {
  id: 'nostr',
  label: 'Nostr',
  charBudget: 10_000,
  maxMedia: 4,
  allowAltText: true,
  allowSensitive: true,
  allowPoll: true,
};

describe('mergeRailCapabilities', () => {
  it('is identity for a single rail', () => {
    const config = mergeRailCapabilities([nostrRail]);
    expect(config.charBudget).toBe(10_000);
    expect(config.maxMedia).toBe(4);
    expect(config.allowPoll).toBe(true);
    expect(config.reasons).toEqual({});
  });

  it('takes min limits and ANDs capabilities across rails', () => {
    const second: RailCapability = {
      id: 'nostr',
      label: 'Other',
      charBudget: 500,
      maxMedia: 1,
      allowAltText: true,
      allowSensitive: false,
      allowPoll: false,
      reasons: { poll: 'Other rail has no polls', sensitive: 'Not supported' },
    };
    const config = mergeRailCapabilities([nostrRail, second]);
    expect(config.charBudget).toBe(500);
    expect(config.maxMedia).toBe(1);
    expect(config.allowPoll).toBe(false);
    expect(config.allowSensitive).toBe(false);
    expect(config.reasons.poll).toBe('Other rail has no polls');
  });

  it('gates media when maxMedia is 0', () => {
    const config = mergeRailCapabilities([
      { ...nostrRail, maxMedia: 0, reasons: { media: 'Upload coming soon' } },
    ]);
    expect(config.reasons.media).toBe('Upload coming soon');
  });

  it('disables everything for no rails', () => {
    const config = mergeRailCapabilities([]);
    expect(config).toMatchObject({ charBudget: 0, maxMedia: 0, allowPoll: false });
  });
});

type MediaBlock = Extract<ComposerBlock, { kind: 'media' }>;
const text = (id: string, t: string): ComposerBlock => ({ id, kind: 'text', text: t });
const image = (id: string, url: string, alt?: string): MediaBlock => ({
  id,
  kind: 'media',
  mediaKind: 'image',
  alt,
  descriptor: { url, sha256: 'abc', mimeType: 'image/jpeg', width: 800, height: 600 },
});

describe('buildNoteEvent', () => {
  it('serializes a text-only new post', () => {
    const note = buildNoteEvent({ blocks: [text('1', 'hello world')], target: { mode: 'new' } });
    expect(note.kind).toBe(1);
    expect(note.content).toBe('hello world');
    expect(note.tags).toEqual([]);
  });

  it('places media urls inline and adds an imeta tag', () => {
    const note = buildNoteEvent({
      blocks: [text('1', 'look'), image('2', 'https://cdn/x.jpg', 'a cat')],
      target: { mode: 'new' },
    });
    expect(note.content).toBe('look\nhttps://cdn/x.jpg');
    expect(note.tags).toContainEqual([
      'imeta',
      'url https://cdn/x.jpg',
      'm image/jpeg',
      'dim 800x600',
      'x abc',
      'alt a cat',
    ]);
  });

  it('builds NIP-10 reply markers with carried p tags', () => {
    const note = buildNoteEvent({
      blocks: [text('1', 'nice')],
      target: {
        mode: 'reply',
        parentId: 'parent',
        parentPubkey: 'pAuthor',
        parentPTags: ['grandparent'],
        rootId: 'root',
        relayHint: 'wss://r',
      },
    });
    expect(note.tags).toContainEqual(['e', 'root', 'wss://r', 'root']);
    expect(note.tags).toContainEqual(['e', 'parent', 'wss://r', 'reply']);
    expect(note.tags).toContainEqual(['p', 'grandparent']);
    expect(note.tags).toContainEqual(['p', 'pAuthor']);
  });

  it('uses a single root marker for a top-level reply', () => {
    const note = buildNoteEvent({
      blocks: [text('1', 'hi')],
      target: { mode: 'reply', parentId: 'parent', parentPubkey: 'a' },
    });
    expect(note.tags.filter((t) => t[0] === 'e')).toEqual([['e', 'parent', '', 'root']]);
  });

  it('builds a quote with q tag and inline nevent', () => {
    const note = buildNoteEvent({
      blocks: [text('1', 'check this')],
      target: { mode: 'quote', quotedId: 'qid', quotedPubkey: 'qpub', quotedNevent: 'nevent1xxx' },
    });
    expect(note.content).toBe('check this\n\nnostr:nevent1xxx');
    expect(note.tags).toContainEqual(['q', 'qid', '', 'qpub']);
    expect(note.tags).toContainEqual(['p', 'qpub']);
  });

  it('adds explicit and sensitive-media content warnings', () => {
    const explicit = buildNoteEvent({
      blocks: [text('1', 'x')],
      target: { mode: 'new' },
      contentWarning: 'nsfw',
    });
    expect(explicit.tags).toContainEqual(['content-warning', 'nsfw']);

    const sensitive = buildNoteEvent({
      blocks: [{ ...image('2', 'https://cdn/y.jpg'), sensitive: true }],
      target: { mode: 'new' },
    });
    expect(sensitive.tags).toContainEqual(['content-warning']);
  });

  it('dedupes mention p tags', () => {
    const note = buildNoteEvent({
      blocks: [text('1', 'hey')],
      target: { mode: 'new' },
      mentionPubkeys: ['a', 'a', 'b'],
    });
    const pTags = note.tags.filter((t) => t[0] === 'p');
    expect(pTags).toEqual([
      ['p', 'a'],
      ['p', 'b'],
    ]);
  });
});
