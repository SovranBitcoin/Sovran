import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');

describe('mint info screen source', () => {
  const source = readFileSync(resolve(ROOT, 'features/mint/screens/MintInfoScreen.tsx'), 'utf8');

  it('renders the mint address from the shared screen path before contacts', () => {
    const mintAddressStart = source.indexOf('<Section title="Mint address">');
    const contactsStart = source.indexOf('{contactRows.length > 0', mintAddressStart);
    const mintAddressBlock = source.slice(mintAddressStart, contactsStart);

    expect(mintAddressStart).toBeGreaterThan(-1);
    expect(contactsStart).toBeGreaterThan(mintAddressStart);
    expect(mintAddressBlock).toContain(
      '<ListGroup.ItemTitle numberOfLines={3}>{mintUrl}</ListGroup.ItemTitle>'
    );
    expect(mintAddressBlock).toContain(
      '<ListGroup.ItemDescription>Tap to copy</ListGroup.ItemDescription>'
    );
    expect(mintAddressBlock).not.toContain('Platform.OS');
  });

  it('uses Nostr profile data to pretty-display the first Nostr contact', () => {
    expect(source).toContain('const contactRows = getSortedMintInfoContacts(contact);');
    expect(source).toContain('useNostrProfile(');
    expect(source).toContain('getMintInfoNostrDisplayName(rowProfile, fallbackNpub ?? c.info)');
    expect(source).toContain('picture={rowPicture}');
  });

  it('keeps the audit block mounted in one slot for every read state', () => {
    // The stats block used to mount only once audit scalars existed, so the
    // page shifted when they landed. Now the slot is always there and swaps
    // skeleton / values / empty / error content in place, with a Retry.
    expect(source).not.toContain(
      "entry?.auditState != null || typeof entry?.auditScore === 'number'"
    );
    expect(source).toContain('testID="mint-info-audit-status"');
    expect(source).toContain('testID="mint-info-audit-retry"');
    expect(source).toContain('status={detail.audit}');
    // Unknown counts never render as zero. The dash now belongs to the shared
    // grid, so both counterparty pages spell "nobody measured this" the same
    // way rather than each declaring their own.
    expect(source).toContain('UNKNOWN_STAT');
    expect(source).toContain("from '@/shared/ui/composed/StatsGrid'");
    expect(source).not.toContain(": '0.0'");
  });

  it('shows a failed identity read inline with a retry instead of a URL-named mint', () => {
    expect(source).toContain('testID="mint-info-retry"');
    expect(source).toContain('onPress={detail.retry}');
    expect(source).toContain("isLoading={detail.identity === 'loading'}");
  });

  it('renders the shared status dot for every audit state', () => {
    expect(source).toContain('<AvatarStatusDot status={status} size={badgeSize} />');
    expect(source).not.toContain('STATUS_BADGE_CONFIG');
  });
});
