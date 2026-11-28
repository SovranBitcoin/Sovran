/**
 * @jest-environment node
 *
 * Callers open the camera without awaiting permission; the camera screen
 * shows black while the permission loads and while its one automatic ask is
 * open, and "permission required" only once that ask has been refused.
 */
const mockPermission: { current: { granted: boolean; canAskAgain: boolean } | null } = {
  current: null,
};
const mockRequest = jest.fn();
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [mockPermission.current, mockRequest],
}));
jest.mock('@/shared/lib/popup', () => ({ paramPopup: jest.fn() }));
jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

/* eslint-disable import/first */
import TestRenderer, { act } from 'react-test-renderer';

import {
  cameraPermissionView,
  useCameraPermissionGate,
} from '@/features/camera/hooks/useHandleCameraPermission';
import { paramPopup } from '@/shared/lib/popup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let gate: ReturnType<typeof useCameraPermissionGate>;
function Probe() {
  gate = useCameraPermissionGate();
  return null;
}

function mount() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<Probe />);
  });
  return tree;
}

beforeEach(() => {
  mockPermission.current = null;
  mockRequest.mockReset();
  jest.mocked(paramPopup).mockReset();
});

describe('cameraPermissionView', () => {
  it('never shows "required" before the permission is known', () => {
    expect(cameraPermissionView(null, false)).toBe('starting');
    expect(cameraPermissionView(null, true)).toBe('starting');
  });

  it('shows black, not "required", until the automatic ask settles', () => {
    expect(cameraPermissionView({ granted: false }, false)).toBe('starting');
    expect(cameraPermissionView({ granted: false }, true)).toBe('required');
  });

  it('shows the camera once granted', () => {
    expect(cameraPermissionView({ granted: true }, false)).toBe('camera');
  });
});

describe('useCameraPermissionGate', () => {
  it('asks once on open and shows "required" only after a refusal', async () => {
    let refuse!: (value: { granted: boolean }) => void;
    mockRequest.mockReturnValue(new Promise((done) => (refuse = done)));
    const tree = mount();
    expect(gate.view).toBe('starting');

    mockPermission.current = { granted: false, canAskAgain: true };
    act(() => tree.update(<Probe />));
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(gate.view).toBe('starting');

    await act(async () => refuse({ granted: false }));
    expect(gate.view).toBe('required');
    expect(paramPopup).toHaveBeenCalledWith('camera-permission', 'denied');

    act(() => tree.update(<Probe />));
    expect(mockRequest).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('does not ask when already granted', () => {
    mockPermission.current = { granted: true, canAskAgain: true };
    const tree = mount();
    expect(gate.view).toBe('camera');
    expect(mockRequest).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('shows the blocked popup and "required" when the system will not ask again', async () => {
    mockPermission.current = { granted: false, canAskAgain: false };
    const tree = mount();
    await act(async () => Promise.resolve());
    expect(mockRequest).not.toHaveBeenCalled();
    expect(paramPopup).toHaveBeenCalledWith('camera-permission', 'blocked');
    expect(gate.view).toBe('required');
    act(() => tree.unmount());
  });
});
