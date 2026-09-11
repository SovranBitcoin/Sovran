import { useMintStore } from '@/shared/stores/profile/mintStore';
import { log, mintUrlLogFields } from '@/shared/lib/logger';
import { ensureTrustedDefaultMint } from './defaultMintInitialization';
import { DEFAULT_MINT_URL, DEFAULT_MINT_URLS } from './defaultMints';

function defaultSelectedMintLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasDefaultSelectedMint: !!mintUrl,
    defaultSelectedMintLength: mintUrl?.length ?? 0,
  };
}

export async function initializeDefaultMints(
  manager: { mint: Parameters<typeof ensureTrustedDefaultMint>[0] },
  isLive: () => boolean
): Promise<void> {
  try {
    log.info('coco.init_default_mints', {
      defaultMintCount: DEFAULT_MINT_URLS.length,
      ...defaultSelectedMintLogFields(DEFAULT_MINT_URL),
    });

    for (const mintUrl of DEFAULT_MINT_URLS) {
      if (!isLive()) return;
      try {
        log.debug('coco.mint_trust_check.start', { ...mintUrlLogFields(mintUrl) });
        const result = await ensureTrustedDefaultMint(manager.mint, mintUrl);
        if (result.status === 'already-trusted') {
          log.debug('coco.mint_exists', { ...mintUrlLogFields(mintUrl) });
          continue;
        }

        log.info('coco.mint_added', {
          ...mintUrlLogFields(mintUrl),
          attempts: result.attempts,
        });
      } catch (error) {
        log.warn('coco.mint_add_failed', { ...mintUrlLogFields(mintUrl), error });
      }
    }

    try {
      const { selectedMint, setSelectedMint } = useMintStore.getState();
      log.debug('coco.default_mint_selection.check', {
        hasSelectedMint: !!selectedMint,
        ...defaultSelectedMintLogFields(DEFAULT_MINT_URL),
      });
      if (isLive() && !selectedMint) {
        const isDefaultTrusted = await manager.mint.isTrustedMint(DEFAULT_MINT_URL);
        if (!isLive() || useMintStore.getState().selectedMint) return;
        if (isDefaultTrusted) {
          setSelectedMint(DEFAULT_MINT_URL);
          log.info('coco.mint_selected', { ...mintUrlLogFields(DEFAULT_MINT_URL) });
        } else {
          log.warn('coco.default_mint_not_trusted', { ...mintUrlLogFields(DEFAULT_MINT_URL) });
        }
      }
    } catch (error) {
      log.warn('coco.mint_select_failed', { error });
    }

    log.info('coco.init_default_mints_done');
  } catch (error) {
    log.error('coco.init_default_mints_failed', { error });
  }
}
