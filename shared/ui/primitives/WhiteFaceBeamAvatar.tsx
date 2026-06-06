import React from 'react';
import Svg, { G, Mask, Path, Rect } from 'react-native-svg';

interface WhiteFaceBeamAvatarProps {
  name: string;
  size: number;
  colors: string[];
  square?: boolean;
}

const BEAM_BASE_SIZE = 36;
const WHITE_FACE_HEAD_COLOR = 'white';
const WHITE_FACE_FEATURE_COLOR = 'black';

function getNumber(name: string) {
  return Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function getDigit(number: number, ntn: number) {
  return Math.floor((number / Math.pow(10, ntn)) % 10);
}

function getBoolean(number: number, ntn: number) {
  return !(getDigit(number, ntn) % 2);
}

function getUnit(number: number, range: number, index?: number) {
  const value = number % range;
  if (index && getDigit(number, index) % 2 === 0) return -value;
  return value;
}

function getRandomColor(number: number, colors: string[]) {
  return colors[number % colors.length] ?? colors[0] ?? 'blue';
}

function createScaleNumber(originalBaseNumber: number, newBaseNumber: number) {
  return function scaleNumber(originalNumber: number): string {
    return Math.ceil((originalNumber / originalBaseNumber) * newBaseNumber).toString();
  };
}

/**
 * Mirrors the Boring Avatars `beam` geometry while overriding the generated
 * color relationship for the White Face style: white head, black features,
 * design-token surroundings.
 */
export function WhiteFaceBeamAvatar({ name, size, colors, square }: WhiteFaceBeamAvatarProps) {
  const numFromName = getNumber(name);
  const scaleNumber = createScaleNumber(BEAM_BASE_SIZE, size);
  const backgroundColor = getRandomColor(numFromName + 13, colors);
  const wrapperRotate = getUnit(numFromName, 360);
  const isMouthOpen = getBoolean(numFromName, 2);
  const isCircle = getBoolean(numFromName, 1);
  const faceRotate = getUnit(numFromName, 10, 3);

  const eyeY = scaleNumber(14);
  const eyeLeftX = scaleNumber(14);
  const eyeRightX = scaleNumber(20);
  const eyeWidth = scaleNumber(1.5);
  const eyeHeight = scaleNumber(2);
  const eyeRadiusX = scaleNumber(1);

  const headBorderRadiusScaler = +scaleNumber(6);
  const headBorderRadius = isCircle ? size : size / headBorderRadiusScaler;

  const preTranslateRange = +scaleNumber(10);
  const translateThreshold = +scaleNumber(5);
  const translateScaler = +scaleNumber(9);

  const preTranslateX = getUnit(numFromName, preTranslateRange, 1);
  const wrapperTranslateX =
    preTranslateX < translateThreshold ? preTranslateX + size / translateScaler : preTranslateX;
  const preTranslateY = getUnit(numFromName, preTranslateRange, 2);
  const wrapperTranslateY =
    preTranslateY < translateThreshold ? preTranslateY + size / translateScaler : preTranslateY;

  const wrapperScaleScaler = +scaleNumber(12);
  const wrapperScaleDivider = +scaleNumber(10);
  const wrapperScale = 1 + getUnit(numFromName, size / wrapperScaleScaler) / wrapperScaleDivider;

  const eyeSpreadRange = +scaleNumber(5);
  const eyeSpread = getUnit(numFromName, eyeSpreadRange);

  const mouthSpreadRange = +scaleNumber(3);
  const mouthSpread = getUnit(numFromName, mouthSpreadRange);

  const faceTranslateScaler = +scaleNumber(6);
  const faceTranslateXRange = +scaleNumber(8);
  const faceTranslateX =
    wrapperTranslateX > size / faceTranslateScaler
      ? wrapperTranslateX / 2
      : getUnit(numFromName, faceTranslateXRange, 1);

  const faceTranslateYRange = 7;
  const faceTranslateY =
    wrapperTranslateY > size / faceTranslateScaler
      ? wrapperTranslateY / 2
      : getUnit(numFromName, faceTranslateYRange, 2);

  const openMouthPath = `M${+scaleNumber(13)},${
    +scaleNumber(19) + mouthSpread
  } a${+scaleNumber(1)},${+scaleNumber(1) * 0.75} 0 0,0 ${+scaleNumber(10)},0`;

  const closedMouthPath = `M${+scaleNumber(15)} ${
    +scaleNumber(19) + mouthSpread
  }c${+scaleNumber(2)} ${+scaleNumber(1)} ${+scaleNumber(4)} ${+scaleNumber(
    1
  )} ${+scaleNumber(6)} 0`;

  const maskId = `mask__white_face_beam_${name}`;

  return (
    <Svg
      testID="white-face-beam-avatar"
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      width={size}
      height={size}>
      <Mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={size} height={size}>
        <Rect width={size} height={size} rx={square ? undefined : size * 2} fill="white" />
      </Mask>
      <G mask={`url(#${maskId})`}>
        <Rect
          testID="white-face-beam-background"
          width={size}
          height={size}
          fill={backgroundColor}
        />
        <Rect
          testID="white-face-beam-head"
          x="0"
          y="0"
          width={size}
          height={size}
          transform={`translate(${wrapperTranslateX} ${wrapperTranslateY}) rotate(${wrapperRotate} ${size / 2} ${size / 2}) scale(${wrapperScale})`}
          fill={WHITE_FACE_HEAD_COLOR}
          rx={headBorderRadius}
        />
        <G
          transform={`translate(${faceTranslateX} ${faceTranslateY}) rotate(${faceRotate} ${size / 2} ${size / 2})`}>
          {isMouthOpen ? (
            <Path
              testID="white-face-beam-mouth"
              d={closedMouthPath}
              stroke={WHITE_FACE_FEATURE_COLOR}
              fill="none"
              strokeLinecap="round"
              strokeWidth={+scaleNumber(1)}
            />
          ) : (
            <Path
              testID="white-face-beam-mouth"
              d={openMouthPath}
              fill={WHITE_FACE_FEATURE_COLOR}
            />
          )}
          <Rect
            testID="white-face-beam-left-eye"
            x={+eyeLeftX - eyeSpread}
            y={eyeY}
            width={eyeWidth}
            height={eyeHeight}
            rx={eyeRadiusX}
            stroke="none"
            fill={WHITE_FACE_FEATURE_COLOR}
          />
          <Rect
            testID="white-face-beam-right-eye"
            x={+eyeRightX + eyeSpread}
            y={eyeY}
            width={eyeWidth}
            height={eyeHeight}
            rx={eyeRadiusX}
            stroke="none"
            fill={WHITE_FACE_FEATURE_COLOR}
          />
        </G>
      </G>
    </Svg>
  );
}
