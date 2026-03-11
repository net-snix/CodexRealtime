import { useMemo, type MutableRefObject } from "react";
import type { TimelineEntry } from "@shared";
import type { PresentedTimelineEntry, PresentedTimelineEvent } from "../timeline-event-stream";
import { buildPresentedTimeline } from "../timeline-event-stream";
import { TimelineRichText } from "./TimelineRichText";

type TimelineEventStreamProps = {
  entries: TimelineEntry[];
  isWorkingLogMode: boolean;
  isRunning: boolean;
  isResolvingRequests: boolean;
  activeWorkingLabel: string;
  latestWorkingStatus: string | null;
  streamRef: MutableRefObject<HTMLDivElement | null>;
};

function ChevronIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="timeline-command-cluster-arrow-icon">
      <path
        d="M3.25 4.5 6 7.25 8.75 4.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function TimelineActivityRow({
  item,
  nested = false
}: {
  item: PresentedTimelineEvent;
  nested?: boolean;
}) {
  const { presentation } = item;

  return (
    <div
      className={`timeline-activity-item timeline-activity-item-${presentation.tone}${
        nested ? " timeline-command-cluster-item" : ""
      }`}
    >
      {!nested && presentation.badge ? (
        <span className="timeline-activity-badge">{presentation.badge}</span>
      ) : null}
      <div className="timeline-activity-copy-stack">
        <p
          className={
            presentation.monospace
              ? "timeline-activity-copy timeline-activity-copy-code"
              : "timeline-activity-copy"
          }
        >
          {presentation.title}
        </p>
        {presentation.body ? (
          <pre className="timeline-message-output timeline-activity-output">{presentation.body}</pre>
        ) : null}
      </div>
      {presentation.metaLabel ? (
        <span className="timeline-activity-meta">{presentation.metaLabel}</span>
      ) : null}
    </div>
  );
}

function TimelineCommandCluster({
  id,
  items
}: Extract<PresentedTimelineEntry, { kind: "commandCluster" }>) {
  return (
    <details className="timeline-command-cluster">
      <summary className="timeline-command-cluster-summary" aria-label={`Show ${items.length} commands`}>
        <span className="timeline-activity-badge">Command</span>
        <p className="timeline-command-cluster-copy">
          <span className="timeline-command-cluster-title">{items.length} commands</span>
        </p>
        <span className="timeline-command-cluster-arrow" aria-hidden="true">
          <ChevronIcon />
        </span>
      </summary>
      <div className="timeline-command-cluster-items">
        {items.map((item) => (
          <TimelineActivityRow key={`${id}-${item.entry.id}`} item={item} nested />
        ))}
      </div>
    </details>
  );
}

function TimelineDiffFiles({ items }: { items: NonNullable<PresentedTimelineEvent["presentation"]["files"]> }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="timeline-diff-files">
      {items.map((file) => (
        <div key={file.path} className="timeline-diff-file">
          <span className="timeline-diff-file-path">{file.path}</span>
          <span className="timeline-diff-file-stats">
            +{file.additions} -{file.deletions}
          </span>
        </div>
      ))}
    </div>
  );
}

function TimelineEntryCard({ item }: { item: PresentedTimelineEvent }) {
  const { presentation } = item;

  if (presentation.variant === "activity") {
    return <TimelineActivityRow item={item} />;
  }

  if (presentation.variant === "diff") {
    return (
      <article className="timeline-message timeline-message-commentary timeline-diff-entry dossier-card">
        <div className="timeline-message-head">
          {presentation.badge ? (
            <span className="timeline-message-badge">{presentation.badge}</span>
          ) : null}
          {presentation.metaLabel ? (
            <span className="timeline-message-meta">{presentation.metaLabel}</span>
          ) : null}
        </div>
        <div className="timeline-diff-entry-copy">
          <strong>{presentation.title}</strong>
          <TimelineDiffFiles items={presentation.files ?? []} />
        </div>
      </article>
    );
  }

  const messageToneClass =
    presentation.variant === "plan"
      ? "timeline-message-plan"
      : `timeline-message-${presentation.tone}`;

  return (
    <article key={item.entry.id} className={`timeline-message ${messageToneClass}`}>
      {presentation.badge || presentation.metaLabel ? (
        <div className="timeline-message-head">
          {presentation.badge ? (
            <span className="timeline-message-badge">{presentation.badge}</span>
          ) : null}
          {presentation.metaLabel ? (
            <span className="timeline-message-meta">{presentation.metaLabel}</span>
          ) : null}
        </div>
      ) : null}
      <TimelineRichText className="timeline-message-copy" text={presentation.body ?? presentation.title} />
    </article>
  );
}

export function TimelineEventStream({
  entries,
  isWorkingLogMode,
  isRunning,
  isResolvingRequests,
  activeWorkingLabel,
  latestWorkingStatus,
  streamRef
}: TimelineEventStreamProps) {
  const { entries: groupedEntries } = useMemo(
    () => buildPresentedTimeline(entries, isWorkingLogMode),
    [entries, isWorkingLogMode]
  );

  return (
    <div
      ref={streamRef}
      className={`timeline-stream timeline-stream-log ${
        isWorkingLogMode ? "timeline-stream-log-active" : ""
      }`}
    >
      {groupedEntries.map((entry) =>
        entry.kind === "commandCluster" ? (
          <TimelineCommandCluster key={entry.id} {...entry} />
        ) : (
          <TimelineEntryCard key={entry.item.entry.id} item={entry.item} />
        )
      )}

      {isRunning || isResolvingRequests ? (
        <div className="timeline-thinking">
          <span className="timeline-thinking-chip">{activeWorkingLabel}</span>
          {latestWorkingStatus || isResolvingRequests ? (
            <p className="timeline-thinking-note">
              {isResolvingRequests ? "Needs your decision to continue" : latestWorkingStatus}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
