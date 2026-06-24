import type { Rect } from './types';

export type Measurable = {
  measureInWindow?: (
    callback: (x: number, y: number, width: number, height: number) => void
  ) => void;
};

export async function measureInWindowAsync(
  ref: Measurable | null | undefined
): Promise<Rect | null> {
  return await new Promise((resolve) => {
    try {
      if (!ref?.measureInWindow) return resolve(null);
      ref.measureInWindow((x: number, y: number, width: number, height: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) {
          resolve(null);
          return;
        }
        resolve({ x, y, width, height });
      });
    } catch {
      resolve(null);
    }
  });
}

export function rafAsync(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
