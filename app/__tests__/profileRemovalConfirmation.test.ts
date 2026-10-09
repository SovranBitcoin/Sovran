import { confirmProfileRemoval } from '@/shared/lib/popup/popups/profileRemoval';
import {
  replaceActionMenuPopup,
  getActionMenuSnapshot,
} from '@/shared/lib/popup/popups/actionMenu';

jest.mock('@/shared/lib/logger', () => ({ log: { child: () => ({ debug: jest.fn() }) } }));

test('imported removal requires two separate confirmations and explains unrecoverable key loss', async () => {
  const request = jest.fn();
  confirmProfileRemoval(
    { accountIndex: 1, pubkey: 'b'.repeat(64), addedAt: 1, source: 'imported' },
    request
  );
  const first = getActionMenuSnapshot();
  await first.payload?.buttons
    ?.find((b) => b.testID === 'profile-remove-confirm')
    ?.onPress?.(() => {});
  expect(request).not.toHaveBeenCalled();
  const second = getActionMenuSnapshot();
  const key = second.payload?.buttons?.find((b) => b.testID === 'profile-remove-key-confirm');
  expect(key?.description).toContain('cannot be recovered from the recovery phrase');
  await key?.onPress?.(() => {});
  expect(request).toHaveBeenCalledWith({
    type: 'remove',
    accountIndex: 1,
    importedKeyConfirmed: true,
  });
});

test('derived confirmation explains phrase recovery and cancel sends no removal', async () => {
  const request = jest.fn();
  confirmProfileRemoval({ accountIndex: 1, pubkey: 'b'.repeat(64), addedAt: 1 }, request);
  const menu = getActionMenuSnapshot();
  expect(menu.payload?.buttons?.[0].description).toContain('added again from your recovery phrase');
  await menu.payload?.buttons
    ?.find((b) => b.testID === 'profile-remove-cancel')
    ?.onPress?.(() => {});
  expect(request).not.toHaveBeenCalled();
  replaceActionMenuPopup({ buttons: [] });
});
