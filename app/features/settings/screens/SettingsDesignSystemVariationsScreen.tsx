/**
 * @fileoverview Design System · Variations.
 *
 * For a component being redesigned, this shows its candidate drawings one at
 * a time: a tab per variant, and under it that variant on every case the
 * component has to handle. Two rows of tabs: which component, which variant.
 * Nothing here is wired to the wallet; the cases are fixed data.
 *
 * A variant is picked by a person, by its code ("T07"). See
 * `design-system/variations/types.ts` for what a variant may and may not do.
 */

import { useState, type ReactElement } from 'react';
import { View } from 'react-native';

import { SUBJECTS, type SubjectId } from '@/features/settings/design-system/variations/subjects';
import type { Subject } from '@/features/settings/design-system/variations/types';
import { useLiveTransactionCases } from '@/features/settings/design-system/variations/useLiveTransactionCases';
import { useStylePaint } from '@/shared/styles/appStyle';
import { PillTabs } from '@/shared/ui/composed/PillTabs';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { Text } from '@/shared/ui/primitives/Text';

function SubjectView<Case>({
  subject,
  cases: casesOverride,
  above,
}: {
  subject: Subject<Case>;
  /** The cases to draw on, when not the subject's own samples. */
  cases?: Subject<Case>['cases'];
  /** A control shown between the variant tabs and the variant. */
  above?: ReactElement;
}) {
  const paint = useStylePaint();
  const { related, item, group } = paint.style.space;
  const cases = casesOverride ?? subject.cases;
  const ids = subject.variants.map((variant) => variant.id);
  const [activeId, setActiveId] = useState(ids[0]);
  const active = subject.variants.find((variant) => variant.id === activeId) ?? subject.variants[0];
  if (!active) {
    return (
      <Text size={14} color={paint.text.secondary}>
        No variants yet.
      </Text>
    );
  }
  return (
    <View style={{ gap: group }}>
      <PillTabs
        tabs={ids}
        activeTab={active.id}
        onTabChange={setActiveId}
        testIDFor={(id) => `ds-variant-${id}`}
      />
      {above}
      <View style={{ gap: related }}>
        <Text size={20} bold family="mona" color={paint.text.primary}>
          {active.id} · {active.name}
        </Text>
        <Text size={14} color={paint.text.secondary}>
          {active.idea}
        </Text>
      </View>
      {subject.arrangement === 'list' ? (
        <View testID={`ds-variant-body-${active.id}`}>
          {cases.map((entry) => (
            <View key={entry.label}>{active.render(entry.item)}</View>
          ))}
        </View>
      ) : (
        <View style={{ gap: group }} testID={`ds-variant-body-${active.id}`}>
          {cases.map((entry) => (
            <View key={entry.label} style={{ gap: item }}>
              <Text size={12} semibold color={paint.text.tertiary}>
                {entry.label}
              </Text>
              {active.render(entry.item)}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const DATA_SOURCES = ['Samples', 'Your history'] as const;

/**
 * The transaction row can also be drawn on the wallet's own recent history:
 * samples cover every state, history shows the mix a person really has.
 */
function TransactionRowView() {
  const paint = useStylePaint();
  const [source, setSource] = useState<(typeof DATA_SOURCES)[number]>('Samples');
  const live = useLiveTransactionCases();
  const subject = SUBJECTS[0];
  const useLive = source === 'Your history';
  return (
    <SubjectView
      subject={subject}
      cases={useLive ? live : subject.cases}
      above={
        <View style={{ gap: paint.style.space.related }}>
          <PillTabs
            tabs={DATA_SOURCES}
            activeTab={source}
            onTabChange={setSource}
            testIDFor={(tab) => `ds-variant-data-${tab === 'Samples' ? 'samples' : 'history'}`}
          />
          {useLive && live.length === 0 ? (
            <Text size={13} color={paint.text.secondary}>
              This wallet has no history yet.
            </Text>
          ) : null}
        </View>
      }
    />
  );
}

// One entry per subject, so each subject's cases stay typed with its variants.
const SUBJECT_VIEWS: Record<SubjectId, () => ReactElement> = {
  'transaction-row': () => <TransactionRowView />,
  timeline: () => <SubjectView subject={SUBJECTS[1]} />,
};

const SUBJECT_IDS = SUBJECTS.map((subject) => subject.id);
const titleOf = (id: SubjectId) => SUBJECTS.find((subject) => subject.id === id)?.title ?? id;

export function SettingsDesignSystemVariationsScreen() {
  const paint = useStylePaint();
  const { gutter, group, related } = paint.style.space;
  const [subjectId, setSubjectId] = useState<SubjectId>(SUBJECT_IDS[0] ?? 'transaction-row');
  const subject = SUBJECTS.find((entry) => entry.id === subjectId);
  return (
    <ScreenWrapper name="SettingsDesignSystemVariationsScreen" scroll="custom" safeArea="scroll">
      <ScreenScrollView contentContainerStyle={{ gap: group, paddingHorizontal: gutter }}>
        <View style={{ gap: related }}>
          <PillTabs
            tabs={SUBJECT_IDS}
            activeTab={subjectId}
            onTabChange={setSubjectId}
            labelFor={titleOf}
            testIDFor={(id) => `ds-subject-${id}`}
          />
          {subject ? (
            <Text size={13} color={paint.text.secondary}>
              {subject.description} {subject.variants.length} variants, {subject.cases.length} cases
              each.
            </Text>
          ) : null}
        </View>
        {/* Keyed so each subject starts on its own first variant. */}
        <View key={subjectId}>{SUBJECT_VIEWS[subjectId]()}</View>
      </ScreenScrollView>
    </ScreenWrapper>
  );
}
