import { useMemo } from 'react';
import { View } from 'react-native';

import { useThemeColor } from '@/shared/hooks/useThemeColor';

/**
 * A reachability dot on the corner of an avatar.
 *
 * Bottom-right and ringed in the surface colour so it reads as sitting on top
 * of the face rather than punched through it — the same construction a
 * presence badge uses in every messaging app, which is the point: the reader
 * already knows what it means before anyone explains it.
 *
 * `null`/absent draws NOTHING, and that is the whole reason this takes three
 * states rather than a boolean. "Nobody has checked yet" is a different claim
 * from "this is down", and a grey dot would still be a dot — a mark in the
 * place where a verdict goes, saying one has been reached. The absence is the
 * honest rendering of an absence.
 *
 * The parent must establish a positioning context (`className="relative"`).
 * The dot is absolutely positioned and takes no layout space, so a 44px avatar
 * in a list row stays exactly 44px wide with one of these on it.
 */

type Presence = 'online' | 'offline';

/** Big enough to see at a glance on a 44px row avatar, small enough not to
 *  eat the face at 70px on the provider page. */
const DOT_SCALE = 0.3;
const MIN_DOT = 9;

export function PresenceDot({
  presence,
  size,
}: {
  /** `null` or omitted when nobody has checked — draws nothing. */
  presence?: Presence | null;
  /** The avatar's size. The dot scales with it. */
  size: number;
}) {
  const [background, success, danger] = useThemeColor(['background', 'success', 'danger'] as const);
  const dotSize = Math.max(MIN_DOT, Math.round(size * DOT_SCALE));
  const color = presence === 'online' ? success : presence === 'offline' ? danger : null;

  const style = useMemo(
    () =>
      color
        ? {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: color,
            borderColor: background,
          }
        : null,
    [background, color, dotSize]
  );

  if (!style) return null;
  return (
    <View
      className="absolute -bottom-px -right-px border-2"
      style={style}
      // The colour is the whole signal for a sighted reader, so the dot has to
      // say it in words for everyone else. A row that is offline ALSO carries
      // "Not answering right now" as its disabled reason, which is where the
      // sighted redundancy went when the Online/Offline pill came out.
      accessibilityLabel={presence === 'online' ? 'Online' : 'Offline'}
    />
  );
}
