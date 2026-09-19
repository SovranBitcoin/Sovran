import { IdentityHeader } from '@/shared/ui/composed/IdentityHeader';

interface RecipientHeaderProps {
  pubkey?: string;
  seed?: string;
  displayName: string;
  avatarUrl?: string | null;
}

export function RecipientHeader({ pubkey, seed, displayName, avatarUrl }: RecipientHeaderProps) {
  return (
    <IdentityHeader
      name={`Pay ${displayName}`}
      seed={seed ?? pubkey ?? displayName}
      picture={avatarUrl}
    />
  );
}
