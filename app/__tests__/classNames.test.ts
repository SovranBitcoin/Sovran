import { cn } from '@/shared/lib/classNames';

describe('cn safe-area merges', () => {
  it('resolves Uniwind safe-area padding, inset, and height conflicts in favour of the last class', () => {
    expect(cn('pb-safe-offset-5', 'pb-0')).toBe('pb-0');
    expect(cn('pb-0', 'pb-safe-offset-5')).toBe('pb-safe-offset-5');
    expect(cn('x-safe', 'inset-x-0')).toBe('inset-x-0');
    expect(cn('y-safe-offset-5', 'inset-y-0')).toBe('inset-y-0');
    expect(cn('h-screen-safe', 'h-20')).toBe('h-20');
    expect(cn('min-h-screen-safe', 'min-h-0')).toBe('min-h-0');
    expect(cn('max-h-screen-safe', 'max-h-full')).toBe('max-h-full');
  });
});
