import { useCallback, useEffect, useState } from 'react';
import { api, type AuditEvent } from '../lib/api.ts';
import { Card, ErrorBlock, Spinner } from '../components/ui.tsx';
import { EmptyState, formatDateTime, formatNumber, titleCase } from '../lib/format.tsx';

export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.audit(action ? { action } : {});
      setEvents(data.events);
      setActions(data.actions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load the audit trail.');
    } finally {
      setLoading(false);
    }
  }, [action]);

  useEffect(() => {
    document.title = 'Audit trail · SaaS Demand Radar';
    void load();
  }, [load]);

  return (
    <div className="page" data-testid="audit-trail">
      <header className="page__header">
        <div>
          <h1>Audit trail</h1>
          <p className="page__subtitle">
            Every sign-in, ingestion, review, re-score and settings change in this workspace.
          </p>
        </div>
        <div className="page__actions">
          <div className="field field--inline">
            <label htmlFor="audit-action">Filter by action</label>
            <select
              id="audit-action"
              value={action}
              onChange={(event) => setAction(event.target.value)}
            >
              <option value="">All actions</option>
              {actions.map((entry) => (
                <option key={entry} value={entry}>
                  {titleCase(entry.replace(/[._]/g, ' '))}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {error ? <ErrorBlock error={error} onRetry={() => void load()} /> : null}
      {loading ? <Spinner label="Loading audit trail…" /> : null}

      {!error ? (
        events.length === 0 ? (
          <EmptyState title="No audit events yet" icon="◎">
            <p>Sign-ins, ingestion runs, reviews and settings changes will appear here.</p>
          </EmptyState>
        ) : (
          <Card
            title={`${formatNumber(events.length)} event${events.length === 1 ? '' : 's'}`}
            description="Newest first, scoped to this workspace."
          >
            <ul className="audit-list" data-testid="audit-list">
              {events.map((event) => (
                <li key={event.id} className="audit-item" data-testid="audit-item">
                  <div className="audit-item__head">
                    <span className="audit-item__action">{event.action}</span>
                    <span className="muted">{formatDateTime(event.createdAt)}</span>
                  </div>
                  <p className="audit-item__summary">{event.summary}</p>
                  <p className="audit-item__meta">
                    actor: {event.actorEmail ?? 'system'} · target: {event.targetType}
                    {event.targetId ? ` #${event.targetId}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : null}
    </div>
  );
}
