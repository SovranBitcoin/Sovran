import { ListGroup } from 'heroui-native';

import { useBalanceContext } from '@cashu/coco-react';
import Icon from 'assets/icons';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { getMintDisplayName } from '@/shared/lib/url';
import { useCachedMintMetadata } from '@/shared/stores/global/mintMetadataStore';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Text } from '@/shared/ui/primitives/Text';

/**
 * One mint a provider will redeem payment from.
 *
 * A bare URL is not an answer to "can I pay this provider" — the user knows
 * their mints by name and icon, and by what is in them. So the row is the same
 * shape the wallet's own mint rows are: icon, name, and the balance held there.
 *
 * The balance sits on the row's second line rather than trailing it. As a
 * trailing amount it rendered at the balance-display scale this app uses for
 * headline figures, which made a four-sat holding shout across the page; on
 * the description line it is a fact about the mint, sized like one.
 */
export function ProviderMintRow({
  mintUrl,
  loading = false,
}: {
  mintUrl: string;
  /** Render the row's own geometry with nothing in it yet. The provider's
   *  accepted-mint list arrives over `/v1/info`, and this is the row that
   *  decides whether the user can pay at all — so the page reserves its exact
   *  shape rather than growing a section under the reader's thumb. */
  loading?: boolean;
}) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const meta = useCachedMintMetadata(mintUrl);
  const { balances } = useBalanceContext();

  // Before the name is resolved, so a placeholder row does not ask the URL
  // helpers what an empty string is called.
  if (loading) {
    // The same chrome, the same two lines, the same 32px icon slot: heroui's
    // own title/description sizes are `text-base` and `text-sm`, so the bars
    // are 16 and 14 and the row lands where the real one will.
    return (
      <ListGroup.Item disabled testID="ai-provider-mint-skeleton">
        <MintIcon size={32} isLoading />
        <ListGroup.ItemContent>
          <Text loading medium size={16} placeholder="Minibits" />
          <Text loading size={14} color={muted} placeholder="1,234 sats" />
        </ListGroup.ItemContent>
      </ListGroup.Item>
    );
  }

  const sats = amountToNumber(balances.byMint[mintUrl]?.total);
  const name = getMintDisplayName(mintUrl, { name: meta?.displayName });

  return (
    <ListGroup.Item disabled testID={`ai-provider-mint:${mintUrl}`}>
      <MintIcon iconUrl={meta?.iconUrl} name={name} size={32} />
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle>{name}</ListGroup.ItemTitle>
        <ListGroup.ItemDescription>
          {sats > 0 ? (
            <AmountFormatter amount={sats} unit="sat" size={13} color={foreground} />
          ) : (
            'Not in your wallet'
          )}
        </ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      {sats > 0 ? <Icon name="mdi:check-circle" size={18} color={foreground} /> : null}
    </ListGroup.Item>
  );
}
