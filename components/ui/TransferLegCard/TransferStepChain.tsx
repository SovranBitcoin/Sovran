/**
 * @fileoverview Horizontal step chain between send and receive rows
 *
 * Shows a horizontal progress chain of dots and lines representing
 * the execution stages of a transfer: Invoice → Send → Done.
 * Matches HistoryEntryTimeline's exact dot/line/icon dimensions.
 *
 * Dimensions (from HistoryEntryTimeline):
 * - Dot container: 20×20, borderRadius: 7 (squircle, NOT circle)
 * - Icon size: 14
 * - Future dot: 7×7 solid circle
 * - Line thickness: 3
 *
 * Icons (from HistoryEntryTimeline):
 * - complete/success/current: fluent:checkmark-16-filled (green)
 * - next-pending: mdi:clock-outline (white 70%)
 * - future: no icon (small solid dot)
 * - failed: material-symbols:close-rounded (red)
 *
 * Used by RebalanceStepRow between the two TransferEntryRow components.
 */

import React, { useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { useThemeColor } from 'hooks/useThemeColor';
import { View } from 'components/ui/View/View';
import { UntranslatedText } from 'components/ui/Text';
import Icon from 'assets/icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

// Step status values from the rebalancer
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
  /** Current step status from the rebalancer */
  status: StepStatus;
  /** Optional routing detail text shown below the chain when routing */
  routingDetail?: string;
  /** Optional middle step label override (default: Send) */
  middleLabel?: string;
  /** Progress accent variant for animated connector */
  progressVariant?: 'default' | 'swap';
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

/** Map a rebalancer StepStatus to a chain of 3 nodes. */
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

// ---------- constants (matching HistoryEntryTimeline exactly) ----------

/** Used only for borderRadius — gives the squircle shape (7 on a 20×20 container) */
const DOT_RADIUS_REF = 14;
const DOT_CONTAINER = 20;
const ICON_SIZE = 14;
const SMALL_DOT = ICON_SIZE / 2; // 7 — matches HistoryEntryTimeline's future-small
const LINE_THICKNESS = 3;
const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

function ChainLine({
  isAnimated,
  greenColor,
  progressAccentColor,
  greyColor,
  animationStop,
}: {
  isAnimated: boolean;
  greenColor: string;
  progressAccentColor: string;
  greyColor: string;
  animationStop: SharedValue<number>;
}) {
  const animatedProps = useAnimatedProps(() => ({
    locations: [0, animationStop.get(), 1] as [number, number, number],
  }));

  if (!isAnimated) {
    return <View style={[styles.line, { backgroundColor: greyColor }]} />;
  }

  return (
    <View style={styles.line}>
      <AnimatedLinearGradient
        animatedProps={animatedProps}
        colors={[greenColor, progressAccentColor, greyColor]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFillObject}
      />
    </View>
  );
}

// ---------- sub-components ----------

function ChainDot({
  type,
  greenColor,
  redColor,
  greyColor,
}: {
  type: NodeType;
  greenColor: string;
  redColor: string;
  greyColor: string;
}) {
  // Future: small solid grey dot (no container, no border, no icon)
  // Matches HistoryEntryTimeline's future-small exactly
  if (type === 'future') {
    return (
      <View
        style={{
          width: SMALL_DOT,
          height: SMALL_DOT,
          borderRadius: SMALL_DOT,
          backgroundColor: greyColor,
          // Horizontal margin so the total width matches DOT_CONTAINER (20),
          // keeping lines aligned with full-size dots.
          marginHorizontal: (DOT_CONTAINER - SMALL_DOT) / 2,
        }}
      />
    );
  }

  // Next pending: grey tinted bg + clock icon
  if (type === 'next-pending') {
    return (
      <View
        style={[
          styles.dot,
          {
            backgroundColor: opacity(greyColor, 0.18),
            borderColor: opacity(greyColor, 0.32),
          },
        ]}>
        <Icon name="mdi:clock-outline" color={opacity('#FFFFFF', 0.7)} size={ICON_SIZE} />
      </View>
    );
  }

  // Failed: red tinted bg + close icon
  if (type === 'failed') {
    return (
      <View
        style={[
          styles.dot,
          {
            backgroundColor: opacity(redColor, 0.18),
            borderColor: opacity(redColor, 0.32),
          },
        ]}>
        <Icon name="material-symbols:close-rounded" color={redColor} size={ICON_SIZE} />
      </View>
    );
  }

  // Complete / current / success: green tinted bg + checkmark (no spinner)
  return (
    <View
      style={[
        styles.dot,
        {
          backgroundColor: opacity(greenColor, 0.18),
          borderColor: opacity(greenColor, 0.32),
        },
      ]}>
      <Icon name="fluent:checkmark-16-filled" color={greenColor} size={ICON_SIZE} />
    </View>
  );
}

// ---------- main component ----------

export const TransferStepChain = React.memo(
  ({
    status,
    routingDetail,
    middleLabel = 'Send',
    progressVariant = 'default',
  }: TransferStepChainProps) => {
    const [foreground, muted, successColor, dangerColor] = useThemeColor([
      'foreground',
      'muted',
      'success',
      'danger',
    ] as const);

    const greenColor = successColor;
    const orangeColor = '#fb923c';
    const progressAccentColor = progressVariant === 'swap' ? orangeColor : greenColor;
    const redColor = dangerColor;
    const greyColor = muted;
    const labelColor = useMemo(() => opacity(foreground, 0.5), [foreground]);

    const chain = useMemo(() => buildChain(status, middleLabel), [middleLabel, status]);
    const animationStop = useSharedValue(0.3);
    const currentIdx = useMemo(() => chain.findIndex((item) => item.type === 'current'), [chain]);
    const animatedLineIdx = useMemo(() => {
      if (currentIdx < 0) return -1;
      if (currentIdx >= chain.length - 1) return -1;
      return currentIdx;
    }, [chain.length, currentIdx]);

    const isRouting = status === 'routing';
    const isInProgress =
      status === 'creatingInvoice' ||
      status === 'invoiceReady' ||
      status === 'melting' ||
      status === 'verifying' ||
      status === 'routing';

    useEffect(() => {
      if (!isInProgress) {
        cancelAnimation(animationStop);
        animationStop.set(0.3);
        return;
      }

      animationStop.set(
        withRepeat(
          withTiming(0.6, {
            duration: 900,
            easing: Easing.inOut(Easing.quad),
          }),
          -1,
          true
        )
      );

      return () => {
        cancelAnimation(animationStop);
      };
    }, [animationStop, isInProgress]);

    return (
      <View style={styles.container}>
        {/* Row of [node-col] [line] [node-col] [line] [node-col]
          Each node-col is a VStack so the label sits directly under its dot. */}
        <View style={styles.chainRow}>
          {chain.map((node, idx) => {
            const isLast = idx === chain.length - 1;
            const nextNode = !isLast ? chain[idx + 1] : null;
            const lineComplete =
              nextNode != null && isCompleteish(node.type) && isCompleteish(nextNode.type);
            const isActive = isCompleteish(node.type);
            const isAnimatedLine = idx === animatedLineIdx;

            return (
              <React.Fragment key={node.label}>
                {/* Node column: dot + label stacked vertically */}
                <View style={styles.nodeColumn}>
                  <ChainDot
                    type={node.type}
                    greenColor={greenColor}
                    redColor={redColor}
                    greyColor={greyColor}
                  />
                  <UntranslatedText
                    size={9}
                    bold={node.type === 'current'}
                    color={isActive ? labelColor : opacity(labelColor, 0.5)}
                    style={styles.label}>
                    {node.label}
                  </UntranslatedText>
                </View>

                {/* Line between nodes — vertically centered with the dot */}
                {!isLast && (
                  <ChainLine
                    isAnimated={isInProgress && isAnimatedLine}
                    greenColor={greenColor}
                    progressAccentColor={progressAccentColor}
                    greyColor={lineComplete ? greenColor : greyColor}
                    animationStop={animationStop}
                  />
                )}
              </React.Fragment>
            );
          })}
        </View>

        {/* Routing detail subtitle */}
        {isRouting && routingDetail ? (
          <UntranslatedText size={10} color="#c084fc" style={styles.routingDetail}>
            {routingDetail}
          </UntranslatedText>
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
    alignItems: 'flex-start', // so lines can be offset to center with dots
  },
  nodeColumn: {
    alignItems: 'center',
  },
  dot: {
    width: DOT_CONTAINER,
    height: DOT_CONTAINER,
    borderRadius: DOT_RADIUS_REF / 2, // 7 — squircle, matching HistoryEntryTimeline
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  line: {
    flex: 1,
    height: LINE_THICKNESS,
    borderRadius: LINE_THICKNESS / 2,
    overflow: 'hidden',
    marginHorizontal: 4,
    // Center the line vertically with the dot:
    // (DOT_CONTAINER - LINE_THICKNESS) / 2 = (20 - 3) / 2 = 8.5
    marginTop: (DOT_CONTAINER - LINE_THICKNESS) / 2,
  },
  label: {
    marginTop: 4,
    textAlign: 'center',
  },
  routingDetail: {
    textAlign: 'center',
    marginTop: 4,
  },
});
