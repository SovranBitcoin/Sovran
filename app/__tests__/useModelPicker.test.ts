/**
 * @jest-environment node
 *
 * Opening the AI model picker: a pick changes the model, the "switched" toast
 * waits for the sheet to go, picking the current model again changes
 * nothing, and the open sheet follows the balance.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useModelPicker } from '@/features/ai/hooks/useModelPicker';
import type { PickerRequest, PickerResult } from '@/shared/lib/picker/types';

const mockSetSelectedSlot = jest.fn();
let mockRoutstr = {
  lineup: null,
  lastKnownLineup: null,
  modelsCache: null,
  selectedProvider: 'openai',
  selectedTier: 'auto',
  setSelectedSlot: mockSetSelectedSlot,
};
jest.mock('@/shared/stores/profile/routstrStore', () => ({
  useRoutstrStore: Object.assign(
    (selector: (state: typeof mockRoutstr) => unknown) => selector(mockRoutstr),
    { getState: () => mockRoutstr }
  ),
}));

let mockBalance = 100;
jest.mock('@/features/ai/hooks/useRoutstrFunds', () => ({
  useRoutstrFunds: () => ({ balanceSats: mockBalance }),
}));

const mockParamPopup = jest.fn();
jest.mock('@/shared/lib/popup', () => ({
  paramPopup: (...args: unknown[]) => mockParamPopup(...args),
}));
jest.mock('@/shared/lib/logger', () => {
  const entry = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    log: { ...entry, child: () => entry },
    storeLog: entry,
    redactError: (error: unknown) => error,
  };
});
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));

const mockUpdate = jest.fn();
let answer: (result: PickerResult) => void = () => {};
let close: () => void = () => {};
const mockOpenPicker = jest.fn((_request: PickerRequest) => ({
  result: new Promise<PickerResult>((resolve) => (answer = resolve)),
  closed: new Promise<void>((resolve) => (close = resolve)),
  update: mockUpdate,
}));
jest.mock('@/shared/lib/picker/openPicker', () => ({
  openPicker: (request: PickerRequest) => mockOpenPicker(request),
}));

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  mockRoutstr = { ...mockRoutstr, selectedProvider: 'openai', selectedTier: 'auto' };
  mockBalance = 100;
  mockSetSelectedSlot.mockClear();
  mockParamPopup.mockClear();
  mockOpenPicker.mockClear();
  mockUpdate.mockClear();
});

describe('useModelPicker', () => {
  it('opens on the selected vendor and changes the model on a pick', async () => {
    const { result } = renderHook(() => useModelPicker());
    act(() => result.current());
    expect(mockOpenPicker.mock.calls[0][0]).toMatchObject({
      title: 'Model',
      initialSectionId: 'openai',
    });

    await act(async () => {
      answer({ kind: 'option', id: 'openai:pro' });
      await flush();
    });
    expect(mockSetSelectedSlot).toHaveBeenCalledWith({ provider: 'openai', tier: 'pro' });
    // The toast would sit beneath the closing sheet.
    expect(mockParamPopup).not.toHaveBeenCalled();

    await act(async () => {
      close();
      await flush();
    });
    expect(mockParamPopup).toHaveBeenCalledWith('model-switched', expect.anything());
  });

  it('changes nothing when the current model is picked again', async () => {
    const { result } = renderHook(() => useModelPicker());
    act(() => result.current());
    await act(async () => {
      answer({ kind: 'option', id: 'openai:auto' });
      close();
      await flush();
    });
    expect(mockSetSelectedSlot).not.toHaveBeenCalled();
    expect(mockParamPopup).not.toHaveBeenCalled();
  });

  it('keeps the open sheet current as the balance changes', () => {
    const { result, rerender } = renderHook(() => useModelPicker());
    act(() => result.current());
    mockUpdate.mockClear();
    mockBalance = 5;
    rerender({});
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Model' }));
  });
});
