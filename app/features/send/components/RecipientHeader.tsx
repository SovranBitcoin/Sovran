import { IdentityBarTitle, IdentityNameBand } from '@/shared/ui/composed/IdentityHeader';
import { Nip05Identity } from '@/shared/ui/composed/Nip05Identity';

interface RecipientHeaderProps {
  pubkey?: string;
  seed?: string;
  displayName: string;
  avatarUrl?: string | null;
}

/** What the amount screen is for, in the wording the payment itself uses. */
function payLabel(displayName: string): string {
  return `Pay ${displayName}`;
}

function recipientSeed({ pubkey, seed, displayName }: RecipientHeaderProps): string {
  return seed ?? pubkey ?? displayName;
}

/**
 * The recipient in the navigation bar: their picture at header-button size,
 * the same as every other identity header. "Pay <name>" rides in
 * {@link RecipientHeaderBand} below the bar, which is the only place a second
 * line fits — the bar row has no room beside a full-size picture.
 */
export function RecipientHeader(props: RecipientHeaderProps) {
  return (
    <IdentityBarTitle
      name={payLabel(props.displayName)}
      seed={recipientSeed(props)}
      picture={props.avatarUrl}
    />
  );
}

/**
 * Mount inside the amount screen; it positions itself under the bar. One
 * column with the picture above it: who is being paid, then the domain they
 * claim. The claim's icon and colour say whether it checked out, so it needs
 * no sentence, and the key itself is on the payment's Details page.
 */
export function RecipientHeaderBand({
  displayName,
  pubkey,
  nip05,
}: Pick<RecipientHeaderProps, 'displayName' | 'pubkey'> & { nip05?: string | null }) {
  return (
    <IdentityNameBand name={payLabel(displayName)}>
      {pubkey && nip05 ? (
        <Nip05Identity address={nip05} pubkey={pubkey} testID="payment-identity-nip05" />
      ) : null}
    </IdentityNameBand>
  );
}
