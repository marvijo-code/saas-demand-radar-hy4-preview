import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type OverviewResponse } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import {
  Card,
  ErrorBlock,
  Spinner,
  StatCard,
  Badge,
} from '../components/ui.tsx';
import {
  EmptyState,
  formatNumber,
  formatRelative,
  PLATFORM_LABELS,
} from '../lib/format.tsx';

export function DashboardPage() {
  const { session } = useAuth();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await api.overview());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load the overview.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    document.title = 'Overview · SaaS Demand Radar';
    void load();
  }, []);

  return (
    <div className="page" data-testid="dashboard">
      <header className="page__header">
        <div>
          <h1>Overview</h1>
          <p className="page__subtitle">
            Live demand signals for {session?.workspace?.name ?? 'your workspace'}.
          </p>
        </div>
        <div className="page__actions">
          <Link className="btn btn--primary" to="/needs">
            Review needs
          </Link>
          <Link className="btn btn--ghost" to="/sources">
            Ingest sources
          </Link>
        </div>
      </header>

      {loading && !data ? <Spinner label="Loading overview…" /> : null}
      {error ? <ErrorBlock error={error} onRetry={() => void load()} /> : null}
      {loading && data ? (
        <p className="muted" role="status">
          Updating…
        </p>
      ) : null}

      {data ? (
        <>
          <div className="stat-grid">
            <StatCard
              label="Public records"
              value={formatNumber(data.counts.records)}
              hint={`${formatNumber(data.platforms.x)} from X · ${formatNumber(data.platforms.reddit)} from Reddit`}
              testId="stat-records"
            />
            <StatCard
              label="Grouped needs"
              value={formatNumber(data.counts.needs)}
              hint="Related evidence clustered together"
              testId="stat-needs"
            />
            <StatCard
              label="Demand signals"
              value={formatNumber(data.counts.signals)}
              hint="Classified intent, pain and workarounds"
              testId="stat-signals"
            />
            <StatCard
              label="Total engagement"
              value={formatNumber(data.counts.engagement)}
              hint="Likes, comments, reposts and upvotes"
              testId="stat-engagement"
            />
            <StatCard
              label="Reviewer feedback"
              value={formatNumber(data.counts.feedback)}
              hint={`Ranking model v${data.model?.version ?? 1}`}
              testId="stat-feedback"
            />
          </div>

          {data.counts.records === 0 ? (
            <EmptyState
              title="No source records yet"
              icon="◎"
            >
              <p>
                Nothing has been ingested for this workspace, so there is no demand to show. Run
                the deterministic snapshot from the <Link to="/sources">Source runs</Link> page to
                populate real public evidence.
              </p>
            </EmptyState>
          ) : (
            <div className="grid grid--two">
              <Card
                title="Signal mix"
                description="How the classified signals break down across all ingested records."
              >
                {data.signalBreakdown.length ? (
                  <ul className="bar-list">
                    {data.signalBreakdown.map((entry) => {
                      const max = Math.max(...data.signalBreakdown.map((item) => item.count));
                      return (
                        <li key={entry.kind}>
                          <span className="bar-list__label">{entry.label}</span>
                          <span className="bar-list__track">
                            <span
                              className="bar-list__fill"
                              style={{ width: `${Math.round((entry.count / max) * 100)}%` }}
                            />
                          </span>
                          <span className="bar-list__value">{entry.count}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="muted">No demand signals detected yet.</p>
                )}
              </Card>

              <Card
                title="Top needs by evidence"
                description="Needs with the most linked public records."
              >
                {data.topNeeds.length ? (
                  <ol className="ranked-list">
                    {data.topNeeds.map((need) => (
                      <li key={need.id}>
                        <Link to={`/needs/${need.id}`}>{need.title}</Link>
                        <div className="ranked-list__meta">
                          <Badge>{need.status}</Badge>
                          <span>{need.evidenceCount} evidence</span>
                          <span>
                            {need.platforms.map((platform) => PLATFORM_LABELS[platform] ?? platform).join(', ')}
                          </span>
                          <span>{formatRelative(need.lastSeenAt)}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted">No needs have been derived yet.</p>
                )}
              </Card>

              <Card title="Ingestion status" description="Latest run and the active schedule.">
                {data.latestRun ? (
                  <dl className="definition-list">
                    <div>
                      <dt>Last run</dt>
                      <dd>
                        {data.latestRun.adapter} · {data.latestRun.status}
                        {data.latestRun.finishedAt
                          ? ` · ${formatRelative(data.latestRun.finishedAt)}`
                          : ''}
                      </dd>
                    </div>
                    <div>
                      <dt>New records</dt>
                      <dd>{formatNumber(data.latestRun.recordsCreated)}</dd>
                    </div>
                    <div>
                      <dt>Schedule</dt>
                      <dd>
                        {data.schedule.enabled
                          ? `Every ${data.schedule.intervalMinutes} min via ${data.schedule.adapter}`
                          : 'Disabled'}
                      </dd>
                    </div>
                    {data.latestRun.error ? (
                      <div>
                        <dt>Error</dt>
                        <dd className="text-danger">{data.latestRun.error.message}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <p className="muted">No ingestion run has completed yet.</p>
                )}
              </Card>

              <Card title="Recent activity" description="Workspace-scoped audit events.">
                {data.recentActivity.length ? (
                  <ul className="activity-list">
                    {data.recentActivity.map((event) => (
                      <li key={event.id}>
                        <span className="activity-list__action">{event.action}</span>
                        <span className="activity-list__summary">{event.summary}</span>
                        <span className="muted">{formatRelative(event.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No activity recorded yet.</p>
                )}
              </Card>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
