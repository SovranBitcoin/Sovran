import {
  createMemoMentionNprofile,
  extractMemoNprofileReferences,
  findActiveMemoMention,
  formatMemoForDisplay,
  insertMemoMentionProfile,
  reconcileMemoMentionEntities,
  serializeMemoWithMentions,
  type MemoMentionToken,
} from '@/shared/lib/popup/popups/sendMemoMention';
import { nip19 } from 'nostr-tools';

const PUBKEY = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];
const NPROFILE = createMemoMentionNprofile(PUBKEY, RELAYS);

describe('send memo mention helpers', () => {
  describe('findActiveMemoMention', () => {
    it('finds an active mention token at the cursor', () => {
      expect(findActiveMemoMention('hello @al', 'hello @al'.length)).toEqual({
        start: 6,
        end: 9,
        query: 'al',
      });
    });

    it('finds an empty mention token after a bare at sign', () => {
      expect(findActiveMemoMention('@', 1)).toEqual({
        start: 0,
        end: 1,
        query: '',
      });
    });

    it('ignores mentions with whitespace before the cursor', () => {
      expect(findActiveMemoMention('hello @al ice', 'hello @al ice'.length)).toBeNull();
    });

    it('ignores at signs embedded inside another token', () => {
      expect(findActiveMemoMention('alice@example.com', 'alice@example'.length)).toBeNull();
    });
  });

  describe('createMemoMentionNprofile', () => {
    it('encodes a NIP-19 nprofile with pubkey and relay hints', () => {
      const decoded = nip19.decode(NPROFILE);

      expect(decoded.type).toBe('nprofile');
      expect(decoded.data).toEqual({
        pubkey: PUBKEY,
        relays: RELAYS,
      });
    });
  });

  describe('insertMemoMentionProfile', () => {
    it('replaces the active mention range with a visible username', () => {
      const mention: MemoMentionToken = { start: 6, end: 12, query: 'alice' };

      expect(
        insertMemoMentionProfile('hello @alice', mention, {
          displayName: 'Alice',
          nprofile: NPROFILE,
        })
      ).toEqual({
        value: 'hello @Alice ',
        cursor: 13,
        entities: [{ start: 6, end: 12, display: '@Alice', nprofile: NPROFILE }],
      });
    });

    it('preserves surrounding memo text', () => {
      const mention: MemoMentionToken = { start: 6, end: 9, query: 'al' };

      expect(
        insertMemoMentionProfile('hello @al today', mention, {
          displayName: 'Alice',
          nprofile: NPROFILE,
        })
      ).toEqual({
        value: 'hello @Alice today',
        cursor: 12,
        entities: [{ start: 6, end: 12, display: '@Alice', nprofile: NPROFILE }],
      });
    });
  });

  describe('serializeMemoWithMentions', () => {
    it('submits nprofile values while keeping the input display short', () => {
      const value = 'hello @Alice today';
      const entities = [{ start: 6, end: 12, display: '@Alice', nprofile: NPROFILE }];

      expect(serializeMemoWithMentions(value, entities)).toBe(`hello ${NPROFILE} today`);
    });

    it('drops stale entities after editing inside the visible label', () => {
      const previous = 'hello @Alice today';
      const next = 'hello @Al today';
      const entities = [{ start: 6, end: 12, display: '@Alice', nprofile: NPROFILE }];

      expect(reconcileMemoMentionEntities(previous, next, entities)).toEqual([]);
      expect(serializeMemoWithMentions(next, [])).toBe(next);
    });

    it('shifts entities when the user edits before the visible label', () => {
      const previous = 'hello @Alice';
      const next = 'hey hello @Alice';
      const entities = [{ start: 6, end: 12, display: '@Alice', nprofile: NPROFILE }];

      expect(reconcileMemoMentionEntities(previous, next, entities)).toEqual([
        { start: 10, end: 16, display: '@Alice', nprofile: NPROFILE },
      ]);
    });
  });

  describe('formatMemoForDisplay', () => {
    it('formats raw nprofile memo text as a visible mention label', () => {
      expect(formatMemoForDisplay(`hello ${NPROFILE}`, () => 'Alice')).toBe('hello @Alice');
    });

    it('extracts pubkeys from nprofile memo text', () => {
      expect(extractMemoNprofileReferences(`hello ${NPROFILE}`)).toEqual([
        { raw: NPROFILE, start: 6, end: 6 + NPROFILE.length, pubkey: PUBKEY },
      ]);
    });
  });
});
