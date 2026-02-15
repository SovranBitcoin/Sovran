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

import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { useTheme } from 'providers/ThemeProvider';
import { View } from 'components/ui/View/View';
import { UntranslatedText } from 'components/ui/Text';
import Icon from 'assets/icons';

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
function buildChain(status: StepStatus): ChainNode[] {
  const labels = ['Invoice', 'Send', 'Done'];

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

export const TransferStepChain = React.memo(({ status, routingDetail }: TransferStepChainProps) => {
  const { getPrimaryColor, getGreenColor, getRedColor } = useTheme();

  const greenColor = useMemo(() => getGreenColor('300'), [getGreenColor]);
  const redColor = useMemo(() => getRedColor('300'), [getRedColor]);
  const greyColor = useMemo(() => getPrimaryColor('400'), [getPrimaryColor]);
  const labelColor = useMemo(() => opacity(getPrimaryColor('0'), 0.5), [getPrimaryColor]);

  const chain = useMemo(() => buildChain(status), [status]);

  const isRouting = status === 'routing';

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
                <View
                  style={[styles.line, { backgroundColor: lineComplete ? greenColor : greyColor }]}
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
});
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
