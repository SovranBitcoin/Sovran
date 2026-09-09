/** @jest-environment node */
import { popup } from '@/shared/lib/popup/popups/engine';
import { showToast, showSheet } from '@/shared/lib/popup/popups/bridge';

jest.mock('@/shared/lib/popup/popups/bridge', () => ({
  showToast: jest.fn(),
  showSheet: jest.fn(),
}));
jest.mock('@/shared/lib/popup/format', () => ({ flattenSegments: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  popupLog: { info: jest.fn() },
}));

describe('service error presentation', () => {
  it('explains Routstr endpoint failures without displaying the raw response', () => {
    popup({
      message: 'Failed to send message',
      type: 'error',
      failure: {
        service: 'routstr',
        error: { status: 404, error: { message: 'Not found', type: 'unknown_error' } },
      },
    });
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Failed to send message',
        description:
          'The AI service could not find the requested model or endpoint (404). Try again later. If this continues, contact support.',
      })
    );
    expect(showSheet).not.toHaveBeenCalled();
  });
});

it('uses the same translation for a sheet and does not pass raw failure data to the bridge', () => {
  popup({
    message: 'Payment failed',
    text: 'untrusted fallback text',
    variant: 'sheet',
    failure: { service: 'cashu', error: { code: 11002, detail: 'private backend detail' } },
  });
  expect(showSheet).toHaveBeenLastCalledWith(
    expect.objectContaining({
      submessage:
        'This ecash is involved in a pending operation. Check its status before trying to spend it again.',
    })
  );
  expect(showSheet).toHaveBeenLastCalledWith(
    expect.not.objectContaining({ failure: expect.anything() })
  );
});

it('preserves intentional application copy when no upstream error is provided', () => {
  popup({ message: 'No mint selected', text: 'Select a mint to continue.', type: 'error' });
  expect(showToast).toHaveBeenLastCalledWith(
    expect.objectContaining({
      description: 'Select a mint to continue.',
    })
  );
});
