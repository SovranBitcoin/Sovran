import { ListGroup } from 'heroui-native';

import { useBalanceContext } from '@cashu/coco-react';
import Icon from 'assets/icons';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { getMintDisplayName } from '@/shared/lib/url';
import { useCachedMintMetadata } from '@/shared/stores/global/mintMetadataStore';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { MintIcon } from '@/shared/ui/composed/MintIcon';

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
export function ProviderMintRow({ mintUrl }: { mintUrl: string }) {
  const foreground = useThemeColor('foreground');
  const meta = useCachedMintMetadata(mintUrl);
  const { balances } = useBalanceContext();
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
