// The detail screen's title names where the transaction is, and the timeline
// card is the one place that has resolved it: the quote's expiry, our
// explorer's count, a cancel tap. The card reports the model it drew here so
// the title can read the same answer instead of guessing from the raw entry.
import { createContext, useContext, useEffect } from 'react';

import type { TimelineModel } from 'wallet';

type TimelineReport = (model: TimelineModel | null) => void;

export const TimelineReportContext = createContext<TimelineReport | null>(null);

/** Hands the drawn model to the enclosing detail screen, and takes it back on unmount. */
export function useReportTimeline(model: TimelineModel): void {
  const report = useContext(TimelineReportContext);
  useEffect(() => {
    report?.(model);
  }, [report, model]);
  useEffect(() => (report ? () => report(null) : undefined), [report]);
}
