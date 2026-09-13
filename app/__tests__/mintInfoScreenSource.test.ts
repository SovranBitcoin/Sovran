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

  it('renders the shared status dot for every audit state', () => {
    expect(source).toContain('<AvatarStatusDot status={status} size={badgeSize} />');
    expect(source).not.toContain('STATUS_BADGE_CONFIG');
  });
});
