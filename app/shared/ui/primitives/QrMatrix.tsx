import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

import { log } from '@/shared/lib/logger';
import { encodeQrPath } from '@/shared/lib/qrPlaceholderFrames';

interface QrMatrixProps {
  value: string;
  /** Edge of the square in points; the code fills it with no quiet zone. */
  size: number;
  color: string;
  backgroundColor: string;
}

/**
 * A static QR code: `qrcode` encodes `value` at error-correction level M and
 * each run of dark modules is one butt-capped stroke, the same geometry the
 * loading placeholder (`qrPlaceholderFrames`) draws. Input `qrcode` cannot
 * encode (empty or over capacity) renders nothing.
 */
export function QrMatrix({ value, size, color, backgroundColor }: QrMatrixProps) {
  const frame = useMemo(() => {
    try {
      return encodeQrPath(value, size);
    } catch (error) {
      log.warn('ui.qrcode.encode_failed', { length: value.length, error });
      return null;
    }
  }, [value, size]);

  if (!frame) return null;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Rect width={size} height={size} fill={backgroundColor} />
      <Path d={frame.d} strokeLinecap="butt" stroke={color} strokeWidth={frame.cellSize} />
    </Svg>
  );
}
