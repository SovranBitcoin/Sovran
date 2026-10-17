/**
 * @jest-environment node
 *
 * The profile switcher in the picker sheet: the rows and tabs it asks for,
 * and that it acts on a choice only once the sheet has gone.
 */

import { openProfileSwitcher } from '@/shared/lib/popup/popups/actionSheets';
import type { PickerRequest, PickerResult } from '@/shared/lib/picker/types';

const mockProfiles = {
  profiles: [
    { accountIndex: 0, pubkey: 'a'.repeat(64), addedAt: 1, cachedBalanceSats: 2100 },
    { accountIndex: 1, pubkey: 'b'.repeat(64), addedAt: 2, cachedDisplayName: 'Second' },
    {
      accountIndex: 77,
      pubkey: 'c'.repeat(64),
      addedAt: 3,
      source: 'imported',
      cachedPicture: 'https://example.com/c.png',
    },
  ],
  activeAccountIndex: 0,
};
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: { getState: () => mockProfiles },
}));

jest.mock('@/shared/lib/identity', () => ({
  resolveIdentityName: ({ pubkey, overrideName }: { pubkey: string; overrideName?: string }) =>
    overrideName ?? `name-${pubkey.slice(0, 1)}`,
}));

jest.mock('@/shared/ui/composed/AmountFormatter', () => ({ AmountFormatter: () => null }));

const mockActionMenuPopup = jest.fn();
jest.mock('@/shared/lib/popup/popups/actionMenu', () => ({
  actionMenuPopup: (...args: unknown[]) => mockActionMenuPopup(...args),
}));

let mockRequest: PickerRequest | null = null;
let answer: (result: PickerResult) => void = () => {};
let close: () => void = () => {};
jest.mock('@/shared/lib/picker/openPicker', () => ({
  openPicker: (request: PickerRequest) => {
    mockRequest = request;
    return {
      result: new Promise<PickerResult>((resolve) => (answer = resolve)),
      closed: new Promise<void>((resolve) => (close = resolve)),
      update: jest.fn(),
    };
  },
}));

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  mockRequest = null;
  mockActionMenuPopup.mockClear();
});

describe('openProfileSwitcher', () => {
  it('asks for Imported and Derived tabs with the active profile checked', () => {
    void openProfileSwitcher({ onRequestAction: jest.fn() });
    const request = mockRequest!;

    expect(request.title).toBe('Select profile');
    expect(request.sections?.map((section) => [section.id, section.testID])).toEqual([
      ['imported', 'profile-tab-imported'],
      ['derived', 'profile-tab-derived'],
    ]);
    const [imported, derived] = request.sections!;
    expect(imported.options.map((option) => option.testID)).toEqual(['profile-row-77']);
    expect(imported.options[0].leading).toEqual({
      avatar: { picture: 'https://example.com/c.png', seed: 'c'.repeat(64), name: 'name-c' },
    });
    expect(
      derived.options.map(({ testID, title, selected, disabled }) => ({
        testID,
        title,
        selected,
        disabled,
      }))
    ).toEqual([
      // Selected is not disabled: the current choice is drawn at full strength.
      { testID: 'profile-row-0', title: 'name-a', selected: true, disabled: undefined },
      { testID: 'profile-row-1', title: 'Second', selected: false, disabled: undefined },
    ]);
    // A balance is drawn only when one is known.
    expect(derived.options[0].trailing).toBeTruthy();
    expect(derived.options[1].trailing).toBeUndefined();
    expect(request.actions?.map((action) => action.testID)).toEqual([
      'profile-import',
      'profile-create',
    ]);
  });

  it('switches only after the sheet has gone', async () => {
    const onRequestAction = jest.fn();
    void openProfileSwitcher({ onRequestAction });
    answer({ kind: 'option', id: '77' });
    await flush();
    expect(onRequestAction).not.toHaveBeenCalled();

    close();
    await flush();
    expect(onRequestAction).toHaveBeenCalledWith({ type: 'switch', accountIndex: 77 });
  });

  it('only closes when the active profile is picked again', async () => {
    const onRequestAction = jest.fn();
    void openProfileSwitcher({ onRequestAction });
    answer({ kind: 'option', id: '0' });
    close();
    await flush();
    expect(onRequestAction).not.toHaveBeenCalled();
  });

  it('creates a profile from the footer', async () => {
    const onRequestAction = jest.fn();
    void openProfileSwitcher({ onRequestAction });
    answer({ kind: 'action', id: 'create' });
    close();
    await flush();
    expect(onRequestAction).toHaveBeenCalledWith({ type: 'create' });
  });

  it('opens the nsec form once the sheet has gone', async () => {
    void openProfileSwitcher({ onRequestAction: jest.fn() });
    answer({ kind: 'action', id: 'import' });
    await flush();
    expect(mockActionMenuPopup).not.toHaveBeenCalled();

    close();
    await flush();
    expect(mockActionMenuPopup).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Import Nostr' })
    );
  });

  it('does nothing when the sheet is dismissed', async () => {
    const onRequestAction = jest.fn();
    void openProfileSwitcher({ onRequestAction });
    answer({ kind: 'dismissed' });
    close();
    await flush();
    expect(onRequestAction).not.toHaveBeenCalled();
    expect(mockActionMenuPopup).not.toHaveBeenCalled();
  });
});
