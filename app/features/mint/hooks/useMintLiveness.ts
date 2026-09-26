import { selectMintLiveness, type MintLiveness } from '@/features/mint/lib/mintLiveness';
import { useCachedMintMetadata } from '@/shared/stores/global/mintMetadataStore';

/** The dot for one mint (the wallet header's pill), from the store. */
export function useMintLiveness(mintUrl: string | null | undefined): MintLiveness {
  const entry = useCachedMintMetadata(mintUrl);
  return selectMintLiveness(entry);
}
