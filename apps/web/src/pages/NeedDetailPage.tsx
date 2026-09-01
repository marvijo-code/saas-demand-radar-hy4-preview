import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type NeedDetail, type NeedEvidenceItem } from '../lib/api.ts';
import { ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { ScoreExplanation, TrendChart } from '../components/Charts.tsx';
import { EvidenceCard } from '../components/EvidenceCard.tsx';
import { Badge, Card, ErrorBlock, Spinner } from '../components/ui.tsx';
import {
  EmptyState,
  PLATFORM_LABELS,
  STATUSES,
  STATUS_LABELS,
  WINDOWS,
  classNames,
  formatNumber,
  formatRelative,
} from '../lib/format.tsx';

export function NeedDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [need, setNeed] = useState<NeedDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const windowKey = params.get('window') ?? 'all';

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.need(id, { window: windowKey });
      setNeed(response.need);
      document.title = `${response.need.title.slice(0, 60)} · SaaS Demand Radar`;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setError('This need does not exist in your workspace.');
      } else {
        setError(caught instanceof Error ? caught.message : 'Unable to load this need.');
      }
    } finally {
      setLoading(false);
    }
  }, [id, windowKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendFeedback(body: {
    relevant?: boolean | null;
    willingnessToPay?: boolean;
    contacted?: boolean;
    note?: string | null;
  }) {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.needFeedback(id, body);
      setActionMessage('Feedback saved. Scores now use it; re-score to create a new model version.');
      setNote('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save feedback.');
    } finally {
      setBusy(false);
    }
  }

  async function sendEvidenceFeedback(
    evidence: NeedEvidenceItem,
    decision: { relevant?: boolean | null; willingnessToPay?: boolean; contacted?: boolean },
  ) {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.evidenceFeedback(id, evidence.sourceRecordId, decision);
      setActionMessage('Evidence feedback saved and applied to the learned weights.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save feedback.');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: string) {
    if (!id) return;
    setBusy(true);
    try {
      await api.needStatus(id, status);
      await load();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to change status.');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !need) return <Spinner label="Loading need…" />;

  if (error && !need) {
    return (
      <div className="page" data-testid="need-detail">
        <ErrorBlock error={error} onRetry={() => void load()} />
        <Link to="/needs" className="btn btn--ghost">
          Back to needs
        </Link>
      </div>
    );
  }

  if (!need) {
    return (
      <div className="page" data-testid="need-detail">
        <EmptyState title="Need not found" icon="◎">
          <p>
            <Link to="/needs">Return to the needs list</Link>
          </p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="page" data-testid="need-detail">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/needs">Needs</Link>
        <span aria-hidden="true">/</span>
        <span>Need #{need.id}</span>
      </nav>

      <header className="page__header">
        <div>
          <h1>{need.title}</h1>
          <p className="page__subtitle">{need.summary}</p>
          <div className="page__meta">
            <Badge tone={need.status === 'validated' ? 'positive' : 'neutral'}>
              {STATUS_LABELS[need.status] ?? need.status}
            </Badge>
            {need.platforms.map((platform) => (
              <Badge key={platform} tone="info">
                {PLATFORM_LABELS[platform] ?? platform}
              </Badge>
            ))}
            <span>First seen {formatRelative(need.firstSeenAt)}</span>
            <span>Last seen {formatRelative(need.lastSeenAt)}</span>
          </div>
        </div>
        <div className="page__actions">
          <label className="field field--inline">
            <span>Status</span>
            <select
              value={need.status}
              disabled={busy}
              onChange={(event) => void changeStatus(event.target.value)}
              aria-label="Need status"
            >
              {STATUSES.map((entry) => (
                <option key={entry} value={entry}>
                  {STATUS_LABELS[entry]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate(`/feedback?need=${need.id}`)}
          >
            Open in learning view
          </button>
        </div>
      </header>

      {error ? <ErrorBlock error={error} onRetry={() => void load()} /> : null}
      {actionMessage ? (
        <p className="notice" role="status">
          {actionMessage}
        </p>
      ) : null}

      <div className="grid grid--two">
        <Card
          title={`Demand score ${need.score.toFixed(1)} / 100`}
          description={`Computed with ranking model v${
            need.scoreHistory[need.scoreHistory.length - 1]?.version ?? 1
          } over the ${WINDOWS.find((entry) => entry.key === windowKey)?.long ?? 'selected'} window.`}
        >
          <ScoreExplanation
            components={need.breakdown.components}
            explanation={need.breakdown.explanation}
            basePoints={need.breakdown.basePoints}
            phraseMultiplier={need.breakdown.phraseMultiplier}
            sourceMultiplier={need.breakdown.sourceMultiplier}
            feedbackMultiplier={need.breakdown.feedbackMultiplier}
            bonusPoints={need.breakdown.bonusPoints}
          />
        </Card>

        <div className="stack">
          <Card title="Trend" description="Evidence volume per bucket in the selected window.">
            <div className="segmented segmented--small" role="group" aria-label="Trend window">
              {WINDOWS.map((entry) => (
                <Link
                  key={entry.key}
                  to={`/needs/${need.id}?window=${entry.key}`}
                  className={classNames('segmented__item', windowKey === entry.key && 'is-active')}
                  data-testid={`trend-window-${entry.key}`}
                >
                  {entry.label}
                </Link>
              ))}
            </div>
            <TrendChart points={need.trend} />
          </Card>

          <Card title="Score history" description="Persisted score per ranking-model version.">
            {need.scoreHistory.length ? (
              <table className="table">
                <caption className="sr-only">Score by ranking model version</caption>
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">Score</th>
                    <th scope="col">Rank</th>
                    <th scope="col">Computed</th>
                  </tr>
                </thead>
                <tbody>
                  {need.scoreHistory.map((point) => (
                    <tr key={point.version}>
                      <th scope="row">v{point.version}</th>
                      <td>{point.score.toFixed(1)}</td>
                      <td>{point.rank ?? '—'}</td>
                      <td>{formatRelative(point.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No versioned score has been computed yet.</p>
            )}
          </Card>
        </div>
      </div>

      <Card
        title="Review this need"
        description="Feedback is stored immediately and changes the learned phrase and source weights."
        testId="need-feedback"
      >
        <div className="feedback-form">
          <div className="feedback-form__buttons">
            <button
              type="button"
              className="btn btn--positive"
              disabled={busy}
              onClick={() => void sendFeedback({ relevant: true, note: note || null })}
            >
              Relevant
            </button>
            <button
              type="button"
              className="btn btn--negative"
              disabled={busy}
              onClick={() => void sendFeedback({ relevant: false, note: note || null })}
            >
              Irrelevant
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void sendFeedback({ willingnessToPay: true, note: note || null })}
            >
              Willing to pay
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void sendFeedback({ contacted: true, note: note || null })}
            >
              Contacted lead
            </button>
          </div>
          <div className="field field--grow">
            <label htmlFor="need-note">Note (optional)</label>
            <input
              id="need-note"
              type="text"
              value={note}
              maxLength={1000}
              placeholder="Why is this relevant, who did you contact?"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>
        <p className="muted">
          {formatNumber(need.feedback.relevant)} relevant ·{' '}
          {formatNumber(need.feedback.irrelevant)} irrelevant ·{' '}
          {formatNumber(need.feedback.willingnessToPay)} willing to pay ·{' '}
          {formatNumber(need.feedback.contacted)} contacted
        </p>
      </Card>

      <Card
        title={`Source evidence (${need.evidence.length})`}
        description="Every public record behind this need, linked to its original URL."
        testId="need-evidence"
      >
        {need.evidence.length ? (
          <div className="stack">
            {need.evidence.map((evidence) => (
              <EvidenceCard
                key={evidence.id}
                evidence={evidence}
                busy={busy}
                onFeedback={(record, decision) => void sendEvidenceFeedback(record, decision)}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No evidence in this window" icon="◎">
            <p>Widen the time window to see the records that formed this need.</p>
          </EmptyState>
        )}
      </Card>

      <Card title="Feedback history" description="Every review recorded against this need.">
        {need.feedbackHistory.length ? (
          <table className="table">
            <caption className="sr-only">Feedback history</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Reviewer</th>
                <th scope="col">Target</th>
                <th scope="col">Decision</th>
                <th scope="col">Outcomes</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {need.feedbackHistory.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatRelative(entry.createdAt)}</td>
                  <td>{entry.actorEmail ?? '—'}</td>
                  <td>{entry.targetType === 'need' ? 'Need' : `Evidence #${entry.sourceRecordId}`}</td>
                  <td>
                    {entry.relevant === null
                      ? 'Unrated'
                      : entry.relevant
                        ? 'Relevant'
                        : 'Irrelevant'}
                  </td>
                  <td>
                    {[
                      entry.willingnessToPay ? 'willing to pay' : '',
                      entry.contacted ? 'contacted' : '',
                    ]
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </td>
                  <td>{entry.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No feedback recorded for this need yet.</p>
        )}
      </Card>
    </div>
  );
}
