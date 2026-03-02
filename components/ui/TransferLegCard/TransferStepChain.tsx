/**
 * @fileoverview Animated horizontal step chain between send and receive rows
 *
 * Shows a horizontal progress chain: Invoice → Send → Done.
 * Transitions are sequenced so they cascade left→right:
 *   dot completes → line fills → next dot activates
 *
 * On forward progression (e.g. creatingInvoice → melting), each element
 * receives a stagger delay via Reanimated's withDelay so the wavefront
 * feels sequential rather than simultaneous. Backwards jumps (failed,
 * reset) snap instantly with no stagger.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';

import opacity from 'hex-color-opacity';

import { useThemeColor } from 'hooks/useThemeColor';
import { View } from 'components/ui/View/View';
import { HStack } from 'components/ui/View/HStack';
import { UntranslatedText } from 'components/ui/Text';
import { Spinner } from 'components/ui/Spinner';
import Icon from 'assets/icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

type StepStatus =
  | 'pending'
  | 'creatingInvoice'
  | 'invoiceReady'
  | 'melting'
  | 'verifying'
  | 'routing'
  | 'done'
  | 'failed'
  | 'skipped';

interface TransferStepChainProps {
  status: StepStatus;
  routingDetail?: string;
  middleLabel?: string;
}

// ---------- internal types ----------

type NodeType = 'complete' | 'current' | 'next-pending' | 'future' | 'failed' | 'success';

interface ChainNode {
  label: string;
  type: NodeType;
}

// ---------- helpers ----------

function isCompleteish(type: NodeType): boolean {
  return type === 'complete' || type === 'current' || type === 'success';
}

function isDoneNode(type: NodeType): boolean {
  return type === 'complete' || type === 'success';
}

function buildChain(status: StepStatus, middleLabel: string): ChainNode[] {
  const labels = ['Invoice', middleLabel, 'Done'];

  let currentIdx: number;
  switch (status) {
    case 'pending':
      currentIdx = -1;
      break;
    case 'creatingInvoice':
    case 'invoiceReady':
      currentIdx = 0;
      break;
    case 'melting':
    case 'verifying':
    case 'routing':
      currentIdx = 1;
      break;
    case 'done':
      currentIdx = 2;
      break;
    case 'failed':
      currentIdx = -2;
      break;
    case 'skipped':
      currentIdx = -3;
      break;
    default:
      currentIdx = -1;
  }

  if (status === 'skipped') {
    return labels.map((label) => ({ label, type: 'future' as NodeType }));
  }

  if (status === 'failed') {
    return labels.map((label) => ({ label, type: 'failed' as NodeType }));
  }

  return labels.map((label, idx) => {
    let type: NodeType;
    if (idx < currentIdx) {
      type = 'complete';
    } else if (idx === currentIdx) {
      type = idx === labels.length - 1 ? 'success' : 'current';
    } else if (idx === currentIdx + 1) {
      type = 'next-pending';
    } else {
      type = 'future';
    }
    return { label, type };
  });
}

function statusToCurrentIdx(status: StepStatus): number {
  switch (status) {
    case 'creatingInvoice':
    case 'invoiceReady':
      return 0;
    case 'melting':
    case 'verifying':
    case 'routing':
      return 1;
    case 'done':
      return 2;
    default:
      return -1;
  }
}

// ---------- constants ----------

const DOT_RADIUS_REF = 14;
const DOT_CONTAINER = 20;
const ICON_SIZE = 14;
const SMALL_DOT = ICON_SIZE / 2;
const LINE_THICKNESS = 3;

const DOT_ANIM_MS = 300;
const LINE_ANIM_MS = 360;

const DOT_TIMING = { duration: DOT_ANIM_MS, easing: Easing.out(Easing.cubic) };
const FAST_TIMING = { duration: 200, easing: Easing.out(Easing.cubic) };
const LINE_TIMING = { duration: LINE_ANIM_MS, easing: Easing.inOut(Easing.cubic) };

// ---------- delayed animation helper ----------

function timed(target: number, delayMs: number, config: { duration: number; easing: any }) {
  return delayMs > 0 ? withDelay(delayMs, withTiming(target, config)) : withTiming(target, config);
}

// ---------- Animated dot ----------

function AnimatedChainDot({
  type,
  delayMs,
  greenColor,
  redColor,
  greyColor,
}: {
  type: NodeType;
  delayMs: number;
  greenColor: string;
  redColor: string;
  greyColor: string;
}) {
  const isFuture = type === 'future';
  const isComplete = isCompleteish(type);
  const isPending = type === 'next-pending';
  const isFailed = type === 'failed';

  const futureOp = useSharedValue(isFuture ? 1 : 0);
  const pendingOp = useSharedValue(isPending ? 1 : 0);
  const completeOp = useSharedValue(isComplete ? 1 : 0);
  const failedOp = useSharedValue(isFailed ? 1 : 0);
  const dotScale = useSharedValue(isFuture ? SMALL_DOT / DOT_CONTAINER : 1);

  useEffect(() => {
    futureOp.set(timed(isFuture ? 1 : 0, delayMs, FAST_TIMING));
    pendingOp.set(timed(isPending ? 1 : 0, delayMs, DOT_TIMING));
    completeOp.set(timed(isComplete ? 1 : 0, delayMs, DOT_TIMING));
    failedOp.set(timed(isFailed ? 1 : 0, delayMs, DOT_TIMING));
    dotScale.set(timed(isFuture ? SMALL_DOT / DOT_CONTAINER : 1, delayMs, DOT_TIMING));
  }, [
    type,
    delayMs,
    isFuture,
    isPending,
    isComplete,
    isFailed,
    futureOp,
    pendingOp,
    completeOp,
    failedOp,
    dotScale,
  ]);

  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: dotScale.get() }],
  }));
  const futureStyle = useAnimatedStyle(() => ({ opacity: futureOp.get() }));
  const pendingStyle = useAnimatedStyle(() => ({ opacity: pendingOp.get() }));
  const completeStyle = useAnimatedStyle(() => ({ opacity: completeOp.get() }));
  const failedStyle = useAnimatedStyle(() => ({ opacity: failedOp.get() }));

  const greenBg = useMemo(() => opacity(greenColor, 0.18), [greenColor]);
  const greenBorder = useMemo(() => opacity(greenColor, 0.32), [greenColor]);
  const greyBg = useMemo(() => opacity(greyColor, 0.18), [greyColor]);
  const greyBorder = useMemo(() => opacity(greyColor, 0.32), [greyColor]);
  const redBg = useMemo(() => opacity(redColor, 0.18), [redColor]);
  const redBorder = useMemo(() => opacity(redColor, 0.32), [redColor]);
  const clockColor = useMemo(() => opacity('#FFFFFF', 0.7), []);

  return (
    <Animated.View style={[styles.dotWrapper, scaleStyle]}>
      <Animated.View
        style={[
          styles.dotLayer,
          { borderRadius: DOT_CONTAINER, backgroundColor: greyColor },
          futureStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.dotLayer,
          styles.dot,
          { backgroundColor: greyBg, borderColor: greyBorder },
          pendingStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.dotLayer,
          styles.dot,
          { backgroundColor: greenBg, borderColor: greenBorder },
          completeStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.dotLayer,
          styles.dot,
          { backgroundColor: redBg, borderColor: redBorder },
          failedStyle,
        ]}
      />

      <Animated.View style={[styles.iconLayer, pendingStyle]}>
        <Icon name="mdi:clock-outline" color={clockColor} size={ICON_SIZE} />
      </Animated.View>
      <Animated.View style={[styles.iconLayer, completeStyle]}>
        <Icon name="fluent:checkmark-16-filled" color={greenColor} size={ICON_SIZE} />
      </Animated.View>
      <Animated.View style={[styles.iconLayer, failedStyle]}>
        <Icon name="material-symbols:close-rounded" color={redColor} size={ICON_SIZE} />
      </Animated.View>
    </Animated.View>
  );
}

// ---------- Animated line ----------

function AnimatedChainLine({
  filled,
  delayMs,
  greenColor,
  greyColor,
}: {
  filled: boolean;
  delayMs: number;
  greenColor: string;
  greyColor: string;
}) {
  const fillWidth = useSharedValue(filled ? 1 : 0);

  useEffect(() => {
    fillWidth.set(timed(filled ? 1 : 0, delayMs, LINE_TIMING));
  }, [filled, delayMs, fillWidth]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fillWidth.get() * 100}%`,
  }));

  return (
    <View style={[styles.line, { backgroundColor: greyColor }]}>
      <Animated.View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: greenColor }, fillStyle]}
      />
    </View>
  );
}

// ---------- Animated label ----------

function AnimatedLabel({
  label,
  active,
  delayMs,
  isCurrent,
  labelColor,
  dimColor,
}: {
  label: string;
  active: boolean;
  delayMs: number;
  isCurrent: boolean;
  labelColor: string;
  dimColor: string;
}) {
  const op = useSharedValue(active ? 1 : 0.5);

  useEffect(() => {
    op.set(timed(active ? 1 : 0.5, delayMs, FAST_TIMING));
  }, [active, delayMs, op]);

  const animStyle = useAnimatedStyle(() => ({ opacity: op.get() }));

  return (
    <Animated.View style={[styles.label, animStyle]}>
      <UntranslatedText
        size={9}
        bold={isCurrent}
        color={active ? labelColor : dimColor}
        style={{ textAlign: 'center' }}>
        {label}
      </UntranslatedText>
    </Animated.View>
  );
}

// ---------- main component ----------

export const TransferStepChain = React.memo(
  ({ status, routingDetail, middleLabel = 'Send' }: TransferStepChainProps) => {
    const [foreground, muted, successColor, dangerColor] = useThemeColor([
      'foreground',
      'muted',
      'success',
      'danger',
    ] as const);

    const greenColor = successColor;
    const redColor = dangerColor;
    const greyColor = muted;
    const labelColor = useMemo(() => opacity(foreground, 0.5), [foreground]);
    const dimLabelColor = useMemo(() => opacity(foreground, 0.25), [foreground]);

    const chain = useMemo(() => buildChain(status, middleLabel), [middleLabel, status]);
    const currentIdx = statusToCurrentIdx(status);

    // ── Stagger delay computation ──
    // Track previous currentIdx to detect forward progression.
    // On forward steps (e.g. 0→1), stagger: dot(0ms) → line(DOT) → next dot(DOT+LINE).
    // On non-forward changes (failed, reset, initial), all delays = 0.
    const prevIdxRef = useRef(currentIdx);

    const isForward = currentIdx > prevIdxRef.current && prevIdxRef.current >= 0;
    const wavefrontOrigin = isForward ? prevIdxRef.current : -1;

    // Compute per-node and per-line delays
    const nodeDelays = useMemo(() => {
      const delays = new Array(chain.length).fill(0) as number[];
      if (wavefrontOrigin < 0) return delays;

      for (let i = 0; i < chain.length; i++) {
        if (i <= wavefrontOrigin) {
          delays[i] = 0;
        } else {
          delays[i] = DOT_ANIM_MS + LINE_ANIM_MS;
        }
      }
      return delays;
    }, [chain.length, wavefrontOrigin]);

    const lineDelays = useMemo(() => {
      const delays = new Array(Math.max(0, chain.length - 1)).fill(0) as number[];
      if (wavefrontOrigin < 0) return delays;

      for (let i = 0; i < delays.length; i++) {
        if (i < wavefrontOrigin) {
          delays[i] = 0;
        } else if (i === wavefrontOrigin) {
          delays[i] = DOT_ANIM_MS;
        } else {
          delays[i] = DOT_ANIM_MS + LINE_ANIM_MS;
        }
      }
      return delays;
    }, [chain.length, wavefrontOrigin]);

    // Update ref after delay computation (useEffect runs after render)
    useEffect(() => {
      prevIdxRef.current = currentIdx;
    }, [currentIdx]);

    const isRouting = status === 'routing';

    return (
      <View style={styles.container}>
        <View style={styles.chainRow}>
          {chain.map((node, idx) => {
            const isLast = idx === chain.length - 1;
            const isActive = isCompleteish(node.type);
            const lineFilled = isDoneNode(node.type);

            return (
              <React.Fragment key={node.label}>
                <View style={styles.nodeColumn}>
                  <AnimatedChainDot
                    type={node.type}
                    delayMs={nodeDelays[idx]}
                    greenColor={greenColor}
                    redColor={redColor}
                    greyColor={greyColor}
                  />
                  <AnimatedLabel
                    label={node.label}
                    active={isActive}
                    delayMs={nodeDelays[idx]}
                    isCurrent={node.type === 'current'}
                    labelColor={labelColor}
                    dimColor={dimLabelColor}
                  />
                </View>

                {!isLast && (
                  <AnimatedChainLine
                    filled={lineFilled}
                    delayMs={lineDelays[idx]}
                    greenColor={greenColor}
                    greyColor={greyColor}
                  />
                )}
              </React.Fragment>
            );
          })}
        </View>

        {isRouting && routingDetail ? (
          <View style={[styles.routingBanner, { backgroundColor: opacity(foreground, 0.08) }]}>
            <HStack spacing={6} align="center" justify="center">
              <Spinner size={12} />
              <UntranslatedText size={11} color={labelColor}>
                {routingDetail}
              </UntranslatedText>
            </HStack>
          </View>
        ) : null}
      </View>
    );
  }
);
TransferStepChain.displayName = 'TransferStepChain';

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  nodeColumn: {
    alignItems: 'center',
  },
  dotWrapper: {
    width: DOT_CONTAINER,
    height: DOT_CONTAINER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  dot: {
    width: DOT_CONTAINER,
    height: DOT_CONTAINER,
    borderRadius: DOT_RADIUS_REF / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    position: 'absolute',
    top: 0,
    left: 0,
  },
  iconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: {
    flex: 1,
    height: LINE_THICKNESS,
    borderRadius: LINE_THICKNESS / 2,
    overflow: 'hidden',
    marginHorizontal: 4,
    marginTop: (DOT_CONTAINER - LINE_THICKNESS) / 2,
  },
  label: {
    marginTop: 4,
  },
  routingBanner: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignSelf: 'center',
  },
});
