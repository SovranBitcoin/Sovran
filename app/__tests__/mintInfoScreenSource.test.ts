import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');

describe('mint info screen source', () => {
  const source = readFileSync(resolve(ROOT, 'features/mint/screens/MintInfoScreen.tsx'), 'utf8');
  // The four stat cards are built by the pure selector the screen renders.
  const statsSource = readFileSync(resolve(ROOT, 'features/mint/lib/mintInfoStats.ts'), 'utf8');

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
    expect(statsSource).toContain('UNKNOWN_STAT');
    expect(statsSource).toContain("from '@/shared/ui/composed/StatsGrid'");
    expect(source).toContain("from '@/shared/ui/composed/StatsGrid'");
    expect(source).not.toContain(": '0.0'");
  });

  it('shows a failed identity read inline with a retry instead of a URL-named mint', () => {
    expect(source).toContain('testID="mint-info-retry"');
    expect(source).toContain('onPress={detail.retry}');
    expect(source).toContain("isLoading={detail.identity === 'loading'}");
  });

  it('keeps the rating chart mounted when no score is known', () => {
    // The chart used to render only for a known score or while loading, so the
    // stars vanished for a mint nobody had rated. Only a failed read with no
    // score swaps it for the warning; otherwise it draws its empty state.
    expect(source).toContain("{hasScore || detail.reviews !== 'error' ? (");
    expect(source).toContain("empty={detail.reviews !== 'loading'}");
    expect(source).not.toContain('still shows nothing');
    const chart = readFileSync(
      resolve(ROOT, 'features/mint/components/RatingBarChart.tsx'),
      'utf8'
    );
    expect(chart).toContain('empty = false');
    expect(chart).toContain('const showSkeleton = !isValidScore && !showEmpty;');
    expect(chart).toContain('No ratings yet');
  });

  it('heads the page with the plain mint header: no ring, no badge, a status line', () => {
    const header = readFileSync(resolve(ROOT, 'features/mint/components/MintHeader.tsx'), 'utf8');
    expect(source).not.toContain('function ProgressRing(');
    expect(source).not.toContain('react-native-svg');
    expect(source).not.toContain('AvatarStatusDot');
    expect(source).toContain('<MintHeader');
    expect(source).toContain('health={mintHealthFromAudit(audit?.state)}');
    expect(source).toContain('collapseAt: 98');
    // A 72pt icon alone, and a status line that always takes its 22pt.
    expect(header).toContain('const ICON_SIZE = 72;');
    expect(header).toContain('h-[22px]');
    expect(header).toContain('const STATUS_FADE_MS = 200;');
    // The success rate is never invented for an unaudited mint.
    expect(source).not.toContain('progress = 0.5');
    expect(source).not.toContain('?? 0.5');
  });

  it('shows no capability pills; the spending fee is in Details', () => {
    expect(source).not.toContain('What this mint supports');
    expect(source).not.toContain('mint-info-capabilities');
    expect(source).toContain('inputFees,\n          })}');
  });

  it('replaces Close with Details in the footer', () => {
    const footer = source.slice(
      source.indexOf('<BottomButtons>'),
      source.indexOf('</BottomButtons>')
    );
    // Close is gone from the footer; the accepter's Reject keeps its old id.
    expect(footer).not.toContain("text: 'Close'");
    expect(footer).toContain("text: 'Reject'");
    expect(
      footer.match(
        /testID: 'mint-info-details-open',\s+text: 'Details',\s+accessibilityLabel: 'Mint details',\s+variant: 'secondary',\s+onPress: \(\) => setDetailsOpen\(true\),/g
      )
    ).toHaveLength(2);
    // The modal opens through the shared DetailsSection, from the footer only.
    expect(source).toContain('<DetailsSection\n          trigger="none"');
    expect(source).toContain('open={detailsOpen}');
    expect(source).toContain('onOpenChange={setDetailsOpen}');
    expect(source).toContain('items={buildMintDetailsRows({');
    // One thing on the page is called Details: the long description is not.
    expect(source).not.toContain('title="Details"');
    expect(source).toContain('testID="mint-info-details"');
  });
});
