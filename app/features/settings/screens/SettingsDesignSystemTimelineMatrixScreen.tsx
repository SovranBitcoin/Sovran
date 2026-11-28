import { useMemo, useState } from 'react';

import { buildTimelineModel, describeSendLock, getCounterparty } from 'wallet';
import {
  TIMELINE_SPACES,
  describeTimelineSurfaces,
  timelineFrameAppearance,
  walkTimelineSpace,
  type TimelineFrame,
} from 'wallet/timeline-space';

import {
  ExpiryBadge,
  TimelineCardView,
  getExpiryBadgeText,
  useStatusHeaderColor,
} from '@/features/transactions';
import { usePaymentCopyResolver } from '@/shared/hooks/usePaymentCopyResolver';
import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';
import { PillTabs } from '@/shared/ui/composed/PillTabs';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { PillButton } from '@/shared/ui/primitives/PillButton';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

const FLOWS = TIMELINE_SPACES.map((space) => space.flow);

/** One card per thing a person can tell apart, with how many raw frames draw it. */
interface MatrixCell {
  frame: TimelineFrame;
  frames: number;
}

function collectCells(flow: string, everyFrame: boolean): MatrixCell[] {
  const space = TIMELINE_SPACES.find((candidate) => candidate.flow === flow) ?? TIMELINE_SPACES[0];
  const frames = walkTimelineSpace(space);
  if (everyFrame) return frames.map((frame) => ({ frame, frames: 1 }));
  const cells = new Map<string, MatrixCell>();
  for (const frame of frames) {
    // The title is part of what is on screen, so two frames with the same rows
    // under different titles are different cells.
    const key = `${timelineFrameAppearance(frame)}#${describeTimelineSurfaces(frame).headerTitle}`;
    const cell = cells.get(key);
    if (cell) cell.frames += 1;
    else cells.set(key, { frame, frames: 1 });
  }
  return [...cells.values()];
}

function MatrixCard({ cell, index }: { cell: MatrixCell; index: number }) {
  const paymentCopy = usePaymentCopyResolver();
  const { node, drawn } = cell.frame;
  const { historyEntry, meltQuote, currentTime, ourPubkeys, onchainConfirmationProgress } =
    node.input;
  // Rebuilt with the app's wording; the fixture's clock, keys and drawn rows
  // stand in for the device's.
  const model = buildTimelineModel({ ...node.input, paymentCopy, doneRowKeys: drawn });
  const surfaces = describeTimelineSurfaces({ node, model }, paymentCopy);
  // Checked against the default wording, which is what the check matches.
  const verdict = describeTimelineSurfaces(cell.frame);
  const disagreement = verdict.disagreement ?? verdict.cardDisagreement;
  const badgeColor = useStatusHeaderColor(surfaces.statusColor);
  const now = currentTime ?? 0;
  const conditions =
    historyEntry.type === 'send'
      ? describeSendLock(historyEntry, { now, ...(ourPubkeys ? { ourPubkeys } : {}) })
      : null;
  const isOnchainMint = historyEntry.type === 'mint' && !!getOnchainMintAddress(historyEntry);
  const badge = getExpiryBadgeText(
    historyEntry,
    meltQuote,
    isOnchainMint,
    now,
    conditions?.unlockAt
  );

  return (
    <View className="mb-6" testID={`timeline-matrix-cell-${index}`}>
      <Text size={11} className="text-foreground/50" selectable>
        {node.name}
        {drawn.length > 0 ? `  ·  drawn: ${drawn.join(', ')}` : '  ·  opened cold'}
        {cell.frames > 1 ? `  ·  ${cell.frames} frames` : ''}
      </Text>
      <Text size={13} bold className="text-foreground mb-2 mt-1">
        {surfaces.headerTitle || '(no title)'}
      </Text>
      {disagreement ? (
        <Text size={12} bold className="text-warning mb-2" testID="timeline-matrix-disagreement">
          {disagreement}
        </Text>
      ) : null}
      {/* Cancel the page's 16px padding so the card's own margin lines up. */}
      <View className="-mx-4">
        <TimelineCardView
          timeline={model.steps}
          cardLabel={surfaces.cardLabel}
          statusHeader={surfaces.statusHeader}
          statusColorType={surfaces.statusColor}
          badge={badge ? <ExpiryBadge text={badge} color={badgeColor} /> : null}
          onchainConfirmationProgress={onchainConfirmationProgress}
          conditions={conditions}
          recipientName={getCounterparty(historyEntry)?.displayName ?? null}
          hasMounted
          entryId={`matrix:${node.name}`}
        />
      </View>
    </View>
  );
}

/**
 * Every state the payment timeline can be in, drawn by the card the detail
 * screens use, from the same state space the wallet's brute-force test walks.
 */
export function SettingsDesignSystemTimelineMatrixScreen() {
  const [flow, setFlow] = useState(FLOWS[0]);
  const [everyFrame, setEveryFrame] = useState(false);
  const [onlyDisagreements, setOnlyDisagreements] = useState(false);

  const cells = useMemo(() => collectCells(flow, everyFrame), [flow, everyFrame]);
  const disagreeing = useMemo(
    () =>
      cells.filter((cell) => {
        const verdict = describeTimelineSurfaces(cell.frame);
        return verdict.disagreement !== null || verdict.cardDisagreement !== null;
      }),
    [cells]
  );
  const shown = onlyDisagreements ? disagreeing : cells;

  return (
    <ScreenWrapper
      name="SettingsDesignSystemTimelineMatrixScreen"
      headerAppearance="opaque"
      stickyContent={
        <View className="border-separator border-b px-5">
          <PillTabs tabs={FLOWS} activeTab={flow} onTabChange={setFlow} />
        </View>
      }>
      <Text size={12} className="text-foreground/60 mb-3 mt-2">
        Each card is one state of this payment type, with the rows a mounted timeline had already
        drawn when it arrived. Above it: the fixture state, then the screen title for that state.
      </Text>
      <View className="mb-2 flex-row gap-2">
        <View className="flex-1">
          <PillButton
            variant={onlyDisagreements ? 'primary' : 'secondary'}
            size="sm"
            testID="timeline-matrix-only-disagreements"
            accessibilityRole="switch"
            accessibilityState={{ checked: onlyDisagreements }}
            onPress={() => setOnlyDisagreements((value) => !value)}>
            <PillButton.Label>Disagreements ({disagreeing.length})</PillButton.Label>
          </PillButton>
        </View>
        <View className="flex-1">
          <PillButton
            variant={everyFrame ? 'primary' : 'secondary'}
            size="sm"
            testID="timeline-matrix-every-frame"
            accessibilityRole="switch"
            accessibilityState={{ checked: everyFrame }}
            onPress={() => setEveryFrame((value) => !value)}>
            <PillButton.Label>Every frame</PillButton.Label>
          </PillButton>
        </View>
      </View>
      <Text size={11} className="text-foreground/50 mb-4" testID="timeline-matrix-count">
        {shown.length} of {cells.length} {everyFrame ? 'frames' : 'distinct states'}
      </Text>
      {shown.map((cell, index) => (
        <MatrixCard key={cell.frame.id} cell={cell} index={index} />
      ))}
    </ScreenWrapper>
  );
}
