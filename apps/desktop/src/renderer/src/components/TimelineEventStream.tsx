import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import type { TimelineDiffEntry, TimelineEntry } from "@shared";
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
  activeWorkStartedAt: string | null;
  streamRef: MutableRefObject<HTMLDivElement | null>;
};

const MAX_VISIBLE_CLUSTER_ITEMS = 6;

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

const formatElapsed = (startedAt: string | null, now: number) => {
  if (!startedAt) return null;
  const startedAtMs = Date.parse(startedAt);
  if (Number.isNaN(startedAtMs)) return null;
  const elapsedMs = Math.max(0, now - startedAtMs);
  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds % 60}s`;
};

const buildDiffMap = (entries: TimelineEntry[]) => {
  const diffsByMessageId = new Map<string, TimelineDiffEntry>();
  const detachedDiffIds = new Set<string>();

  for (const entry of entries) {
    if (entry.kind !== "diffSummary") continue;
    if (entry.assistantMessageId) {
      diffsByMessageId.set(entry.assistantMessageId, entry);
      continue;
    }
    detachedDiffIds.add(entry.id);
  }

  return {
    diffsByMessageId,
    detachedDiffIds
  };
};

const clusterLabel = (items: PresentedTimelineEvent[]) => {
  const firstBadge = items[0]?.presentation.badge;
  const sameBadge = firstBadge
    ? items.every((item) => item.presentation.badge === firstBadge)
    : false;

  if (sameBadge && firstBadge === "Command") {
    return {
      badge: "Command",
      title: `${items.length} command${items.length === 1 ? "" : "s"}`
    };
  }

  if (sameBadge && firstBadge) {
    return {
      badge: firstBadge,
      title: `${items.length} ${firstBadge.toLowerCase()} event${items.length === 1 ? "" : "s"}`
    };
  }

  return {
    badge: "Work",
    title: `${items.length} work events`
  };
};

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

function TimelineActivityCluster({
  id,
  items
}: Extract<PresentedTimelineEntry, { kind: "activityCluster" }>) {
  const { badge, title } = clusterLabel(items);
  const hasOverflow = items.length > MAX_VISIBLE_CLUSTER_ITEMS;
  const visibleItems = hasOverflow ? items.slice(-MAX_VISIBLE_CLUSTER_ITEMS) : items;

  return (
    <details className="timeline-command-cluster">
      <summary className="timeline-command-cluster-summary" aria-label={title}>
        <span className="timeline-activity-badge">{badge}</span>
        <p className="timeline-command-cluster-copy">
          <span className="timeline-command-cluster-title">{title}</span>
        </p>
        <span className="timeline-command-cluster-arrow" aria-hidden="true">
          <ChevronIcon />
        </span>
      </summary>
      <div className="timeline-command-cluster-items">
        {hasOverflow ? (
          <p className="timeline-thinking-note">Showing latest {visibleItems.length} items</p>
        ) : null}
        {visibleItems.map((item) => (
          <TimelineActivityRow key={`${id}-${item.entry.id}`} item={item} nested />
        ))}
      </div>
    </details>
  );
}

function TimelineDiffFiles({ diff }: { diff: TimelineDiffEntry }) {
  if (diff.files.length === 0) {
    return null;
  }

  return (
    <div className="timeline-diff-files">
      {diff.files.map((file) => (
        <div key={`${diff.id}-${file.path}`} className="timeline-diff-file">
          <span className="timeline-diff-file-path">{file.path}</span>
          <span className="timeline-diff-file-stats">
            +{file.additions} -{file.deletions}
          </span>
        </div>
      ))}
    </div>
  );
}

function TimelineWorkingNote({
  isRunning,
  isResolvingRequests,
  latestWorkingStatus,
  activeWorkStartedAt
}: {
  isRunning: boolean;
  isResolvingRequests: boolean;
  latestWorkingStatus: string | null;
  activeWorkStartedAt: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning || isResolvingRequests || !activeWorkStartedAt) {
      return;
    }

    setNow(Date.now());
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [activeWorkStartedAt, isResolvingRequests, isRunning]);

  if (isResolvingRequests) {
    return "Needs your decision to continue";
  }

  if (activeWorkStartedAt) {
    return `Working for ${formatElapsed(activeWorkStartedAt, now) ?? "0s"}`;
  }

  return latestWorkingStatus ?? "Working";
}

function TimelineEntryCard({
  item,
  attachedDiff
}: {
  item: PresentedTimelineEvent;
  attachedDiff?: TimelineDiffEntry | null;
}) {
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
          <TimelineDiffFiles
            diff={{
              id: item.entry.id,
              kind: "diffSummary",
              createdAt: item.entry.createdAt,
              turnId: item.entry.turnId,
              assistantMessageId: null,
              title: presentation.title,
              diff: item.entry.kind === "diffSummary" ? item.entry.diff : "",
              files: presentation.files ?? [],
              additions: presentation.additions ?? 0,
              deletions: presentation.deletions ?? 0
            }}
          />
        </div>
      </article>
    );
  }

  if (item.entry.kind === "message" && item.entry.role === "assistant") {
    return (
      <article className="timeline-message timeline-message-assistant">
        <TimelineRichText className="timeline-message-copy" text={item.entry.text} />
        {attachedDiff ? (
          <div className="timeline-diff-entry-copy">
            <div className="timeline-message-head">
              <span className="timeline-message-badge">Diff</span>
              <span className="timeline-message-meta">
                +{attachedDiff.additions} -{attachedDiff.deletions}
              </span>
            </div>
            <TimelineDiffFiles diff={attachedDiff} />
          </div>
        ) : null}
      </article>
    );
  }

  if (item.entry.kind === "message" && item.entry.role === "user") {
    return (
      <article className="timeline-message timeline-message-user">
        <TimelineRichText className="timeline-message-copy" text={item.entry.text} />
      </article>
    );
  }

  const messageToneClass =
    presentation.variant === "plan"
      ? "timeline-message-plan"
      : `timeline-message-${presentation.tone}`;

  return (
    <article className={`timeline-message ${messageToneClass}`}>
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
  activeWorkStartedAt,
  streamRef
}: TimelineEventStreamProps) {
  const { entries: groupedEntries } = useMemo(
    () => buildPresentedTimeline(entries, isWorkingLogMode),
    [entries, isWorkingLogMode]
  );

  const diffState = useMemo(() => buildDiffMap(entries), [entries]);

  return (
    <div
      ref={streamRef}
      className={`timeline-stream timeline-stream-log ${
        isWorkingLogMode ? "timeline-stream-log-active" : ""
      }`}
    >
      {groupedEntries.map((entry) => {
        if (entry.kind === "activityCluster") {
          return <TimelineActivityCluster key={entry.id} {...entry} />;
        }

        if (
          entry.item.entry.kind === "diffSummary" &&
          !diffState.detachedDiffIds.has(entry.item.entry.id)
        ) {
          return null;
        }

        const attachedDiff =
          entry.item.entry.kind === "message" && entry.item.entry.role === "assistant"
            ? diffState.diffsByMessageId.get(entry.item.entry.id) ?? null
            : null;

        return <TimelineEntryCard key={entry.item.entry.id} item={entry.item} attachedDiff={attachedDiff} />;
      })}

      {isRunning || isResolvingRequests ? (
        <div className="timeline-thinking">
          <span className="timeline-thinking-chip">{activeWorkingLabel}</span>
          <p className="timeline-thinking-note">
            <TimelineWorkingNote
              isRunning={isRunning}
              isResolvingRequests={isResolvingRequests}
              latestWorkingStatus={latestWorkingStatus}
              activeWorkStartedAt={activeWorkStartedAt}
            />
          </p>
        </div>
      ) : null}
    </div>
  );
}
