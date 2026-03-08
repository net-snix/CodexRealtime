import type { TimelineEvent } from "@shared";

interface TimelineProps {
  events: TimelineEvent[];
}

export function Timeline({ events }: TimelineProps) {
  return (
    <section className="timeline panel stagger-2">
      <header className="pane-header">
        <div>
          <span className="panel-eyebrow">Conversation</span>
          <h2>One assistant. One thread.</h2>
        </div>
        <div className="status-pill">Idle</div>
      </header>

      <div className="timeline-stream">
        {events.map((event) => (
          <article key={event.id} className={`timeline-item timeline-item-${event.kind}`}>
            <div className="timeline-meta">
              <span>{event.kind}</span>
              <span>{event.createdAt}</span>
            </div>
            <p>{event.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
