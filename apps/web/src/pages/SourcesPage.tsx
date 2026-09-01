import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type ScheduleSettings,
  type SourceRunItem,
  type SourceRunsResponse,
} from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { Badge, Card, ErrorBlock, Spinner } from '../components/ui.tsx';
import {
  EmptyState,
  formatDateTime,
  formatNumber,
  formatRelative,
  titleCase,
} from '../lib/format.tsx';

const STATUS_TONE: Record<string, 'positive' | 'negative' | 'warning' | 'neutral'> = {
  success: 'positive',
  partial: 'warning',
  failed: 'negative',
  running: 'neutral',
};

export function SourcesPage() {
  const { session } = useAuth();
  const isAdmin = session?.user.role === 'admin';
  const [data, setData] = useState<SourceRunsResponse | null>(null);
  const [adapters, setAdapters] = useState<{ id: string; label: string; ready: boolean; limits: string[] }[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [interval, setInterval] = useState('720');
  const [adapter, setAdapter] = useState('snapshot');
  const [enabled, setEnabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runs, adapterList] = await Promise.all([api.sourceRuns(), api.adapters()]);
      setData(runs);
      setAdapters(adapterList.adapters ?? []);
      setInterval(String(runs.schedule.intervalMinutes));
      setAdapter(runs.schedule.adapter);
      setEnabled(runs.schedule.enabled);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load source runs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Source runs · SaaS Demand Radar';
    void load();
  }, [load]);

  async function ingest(target: string) {
    setBusy(target);
    setError(null);
    setMessage(null);
    try {
      const result = await api.ingest(
        target === 'snapshot' ? { adapter: 'snapshot' } : { adapter: target },
      );
      const run = result.run;
      setMessage(
        `${titleCase(run.adapter)} run ${run.status}: ${run.recordsCreated} new, ${run.recordsUpdated} updated, ${run.recordsFailed} failed of ${run.recordsSeen}.`,
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Ingestion failed.');
    } finally {
      setBusy(null);
    }
  }

  async function retry(runId: string) {
    setBusy(runId);
    setError(null);
    try {
      await api.retryRun(runId);
      setMessage('Retry finished. The new run is at the top of the list.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Retry failed.');
    } finally {
      setBusy(null);
    }
  }

  async function saveSchedule() {
    setBusy('schedule');
    setError(null);
    try {
      await api.updateSchedule({
        enabled,
        intervalMinutes: Number(interval) || 720,
        adapter,
      });
      setMessage('Schedule saved.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save the schedule.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page" data-testid="source-runs">
      <header className="page__header">
        <div>
          <h1>Source runs</h1>
          <p className="page__subtitle">
            Ingestion history, schedule, retry and error detail for every adapter.
          </p>
        </div>
        <div className="page__actions">
          {isAdmin ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy !== null}
              onClick={() => void ingest('snapshot')}
            >
              {busy === 'snapshot' ? 'Ingesting…' : 'Run snapshot ingest'}
            </button>
          ) : (
            <p className="muted">
              Running an ingestion needs the Admin role. You can still read every run and its
              errors.
            </p>
          )}
        </div>
      </header>

      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      {error ? <ErrorBlock error={error} onRetry={() => void load()} /> : null}

      <Card title="Adapters" description="Each adapter is replaceable and reports its own limits.">
        <ul className="adapter-list">
          {adapters.map((entry) => (
            <li key={entry.id} data-testid={`adapter-${entry.id}`}>
              <div className="adapter-list__head">
                <strong>{entry.label}</strong>
                <Badge tone={entry.ready ? 'positive' : 'negative'}>
                  {entry.ready ? 'Ready' : 'Needs credentials'}
                </Badge>
                {isAdmin ? (
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={busy !== null || !entry.ready}
                    onClick={() => void ingest(entry.id)}
                  >
                    {busy === entry.id ? 'Running…' : 'Run now'}
                  </button>
                ) : (
                  <Badge tone="neutral">Admin only</Badge>
                )}
              </div>
              <ul className="adapter-list__limits">
                {entry.limits.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Schedule"
        description="Scheduled ingestion runs in the API process and records retry timing."
        testId="schedule-settings"
      >
        <div className="schedule-form">
          <label className="switch">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!isAdmin}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>Enable scheduled ingestion</span>
          </label>
          <div className="field field--inline">
            <label htmlFor="schedule-adapter">Adapter</label>
            <select
              id="schedule-adapter"
              value={adapter}
              disabled={!isAdmin}
              onChange={(event) => setAdapter(event.target.value)}
            >
              {adapters.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field field--inline">
            <label htmlFor="schedule-interval">Interval (minutes)</label>
            <input
              id="schedule-interval"
              type="number"
              min={5}
              max={43200}
              value={interval}
              disabled={!isAdmin}
              onChange={(event) => setInterval(event.target.value)}
            />
          </div>
          {isAdmin ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy === 'schedule'}
              onClick={() => void saveSchedule()}
            >
              {busy === 'schedule' ? 'Saving…' : 'Save schedule'}
            </button>
          ) : (
            <p className="muted">Only an Admin can change the ingestion schedule.</p>
          )}
        </div>
        {data ? (
          <dl className="definition-list">
            <div>
              <dt>Last run</dt>
              <dd>{formatDateTime(data.schedule.lastRunAt)}</dd>
            </div>
            <div>
              <dt>Last status</dt>
              <dd>{data.schedule.lastStatus ?? 'never run'}</dd>
            </div>
            <div>
              <dt>Next run</dt>
              <dd>{formatDateTime(data.schedule.nextRunAt)}</dd>
            </div>
            <div>
              <dt>Last error</dt>
              <dd className={data.schedule.lastError ? 'text-danger' : undefined}>
                {data.schedule.lastError ?? 'none'}
              </dd>
            </div>
          </dl>
        ) : null}
      </Card>

      {loading && !data ? <Spinner label="Loading source runs…" /> : null}
      {loading && data ? (
        <p className="muted" role="status">
          Updating…
        </p>
      ) : null}

      {data ? (
        data.runs.length === 0 ? (
          <EmptyState title="No ingestion runs yet" icon="◎">
            <p>
              Run the deterministic snapshot above to ingest the public records from{' '}
              <code>source-snapshot.json</code>.
            </p>
          </EmptyState>
        ) : (
          <ul className="run-list" data-testid="run-list">
            {data.runs.map((run) => (
              <li key={run.id} className="run-item" data-testid="run-item">
                <div className="run-item__head">
                  <div>
                    <strong>{titleCase(run.adapter)}</strong>
                    <span className="muted"> · {run.trigger}</span>
                  </div>
                  <Badge tone={STATUS_TONE[run.status] ?? 'neutral'}>{run.status}</Badge>
                </div>
                <dl className="definition-list definition-list--compact">
                  <div>
                    <dt>Started</dt>
                    <dd>{formatDateTime(run.startedAt)}</dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{run.durationMs === null ? '—' : `${run.durationMs} ms`}</dd>
                  </div>
                  <div>
                    <dt>Records</dt>
                    <dd>
                      {formatNumber(run.recordsCreated)} new · {formatNumber(run.recordsUpdated)}{' '}
                      updated · {formatNumber(run.recordsFailed)} failed of{' '}
                      {formatNumber(run.recordsSeen)}
                    </dd>
                  </div>
                  <div>
                    <dt>Derived</dt>
                    <dd>
                      {formatNumber(run.signalsCreated ?? 0)} signals ·{' '}
                      {formatNumber(run.needsCreated ?? 0)} needs
                    </dd>
                  </div>
                </dl>
                {run.notes?.length ? (
                  <ul className="run-item__notes">
                    {run.notes.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                ) : null}
                {run.error ? (
                  <p className="run-item__error">
                    <strong>Error:</strong> {run.error.message}
                    {run.error.detail ? <span> ({run.error.detail})</span> : null}
                  </p>
                ) : null}
                {run.errors?.length ? (
                  <ul className="run-item__errors">
                    {run.errors.map((entry, index) => (
                      <li key={`${index}-${entry.message}`}>
                        {entry.platform ? `[${entry.platform}] ` : ''}
                        {entry.externalId ? `${entry.externalId}: ` : ''}
                        {entry.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="run-item__actions">
                  <span className="muted">{formatRelative(run.startedAt)}</span>
                  {isAdmin ? (
                    <button
                      type="button"
                      className="btn btn--small"
                      disabled={busy !== null}
                      onClick={() => void retry(run.id)}
                    >
                      {busy === run.id ? 'Retrying…' : 'Retry run'}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <p className="muted">
        Signed in as {session?.user.email} · all runs are scoped to {session?.workspace?.name}.
      </p>
    </div>
  );
}
