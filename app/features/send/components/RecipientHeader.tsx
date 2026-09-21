import { IdentityBarTitle, IdentityNameBand } from '@/shared/ui/composed/IdentityHeader';

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

/** Mount inside the amount screen; it positions itself under the bar. */
export function RecipientHeaderBand({ displayName }: Pick<RecipientHeaderProps, 'displayName'>) {
  return <IdentityNameBand name={payLabel(displayName)} />;
}
