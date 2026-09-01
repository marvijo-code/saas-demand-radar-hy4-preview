import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type FeedbackResponse, type RankingVersion } from '../lib/api.ts';
import { Badge, Card, ErrorBlock, Spinner } from '../components/ui.tsx';
import { useAuth } from '../lib/auth.tsx';
import { EmptyState, formatNumber, formatRelative, titleCase } from '../lib/format.tsx';

export function FeedbackPage() {
  const { session } = useAuth();
  const isAdmin = session?.user.role === 'admin';
  const [params] = useSearchParams();
  const focusNeed = params.get('need');
  const [data, setData] = useState<FeedbackResponse | null>(null);
  const [versions, setVersions] = useState<RankingVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    version: number;
    changeSummary: string[];
    changes: {
      needId: number;
      title: string;
      previousScore: number | null;
      score: number;
      previousRank: number | null;
      rank: number | null;
      rankDelta: number | null;
      scoreDelta: number;
    }[];
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [feedback, ranking] = await Promise.all([api.feedback(), api.rankingVersions()]);
      setData(feedback);
      setVersions(ranking.versions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load feedback data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Feedback learning · SaaS Demand Radar';
    void load();
  }, [load]);

  async function rescore() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await api.rescore();
      setResult(outcome);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Re-score failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" data-testid="feedback-learning">
      <header className="page__header">
        <div>
          <h1>Feedback learning</h1>
          <p className="page__subtitle">
            Reviewer decisions are turned into phrase and source weights, then captured as a new
            ranking-model version.
          </p>
        </div>
        <div className="page__actions">
          {isAdmin ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void rescore()}
            >
              {busy ? 'Re-scoring…' : 'Re-score and create version'}
            </button>
          ) : (
            <p className="muted">
              Cutting a new ranking-model version needs the Admin role. Your reviews still
              change the live scores immediately.
            </p>
          )}
        </div>
      </header>

      {error ? <ErrorBlock error={error} onRetry={() => void load()} /> : null}

      {result ? (
        <Card title={`Ranking model v${result.version} created`} testId="rescore-result">
          <ul className="explanation-list">
            {result.changeSummary.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
          {result.changes.length ? (
            <table className="table">
              <caption className="sr-only">Rank and score changes</caption>
              <thead>
                <tr>
                  <th scope="col">Need</th>
                  <th scope="col">Score</th>
                  <th scope="col">Δ score</th>
                  <th scope="col">Rank</th>
                  <th scope="col">Δ rank</th>
                </tr>
              </thead>
              <tbody>
                {result.changes.map((change) => (
                  <tr key={change.needId}>
                    <th scope="row">
                      <Link to={`/needs/${change.needId}`}>{change.title}</Link>
                    </th>
                    <td>
                      {change.previousScore === null ? '—' : change.previousScore.toFixed(1)} →{' '}
                      {change.score.toFixed(1)}
                    </td>
                    <td className={change.scoreDelta >= 0 ? 'text-positive' : 'text-danger'}>
                      {change.scoreDelta >= 0 ? '+' : ''}
                      {change.scoreDelta.toFixed(1)}
                    </td>
                    <td>
                      {change.previousRank ?? '—'} → {change.rank ?? '—'}
                    </td>
                    <td>{change.rankDelta === null ? '—' : change.rankDelta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>
      ) : null}

      {loading && !data ? <Spinner label="Loading feedback…" /> : null}
      {loading && data ? (
        <p className="muted" role="status">
          Updating…
        </p>
      ) : null}

      {data ? (
        <>
          <div className="grid grid--two">
            <Card
              title="Learned phrase weights"
              description="Phrases reviewers marked as relevant are boosted, irrelevant ones are damped."
            >
              {Object.keys(data.weights.phraseWeights).length ? (
                <ul className="weight-list">
                  {Object.entries(data.weights.phraseWeights)
                    .sort((a, b) => b[1] - a[1])
                    .map(([phrase, weight]) => (
                      <li key={phrase}>
                        <span>{phrase}</span>
                        <Badge tone={weight >= 1 ? 'positive' : 'negative'}>
                          ×{weight.toFixed(2)}
                        </Badge>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="muted">
                  No feedback yet, so every phrase is neutral (×1.00).
                </p>
              )}
            </Card>

            <Card
              title="Learned source weights"
              description="Platform level trust learned from reviewer decisions."
            >
              {Object.keys(data.weights.sourceWeights).length ? (
                <ul className="weight-list">
                  {Object.entries(data.weights.sourceWeights).map(([platform, weight]) => (
                    <li key={platform}>
                      <span>{titleCase(platform)}</span>
                      <Badge tone={weight >= 1 ? 'positive' : 'negative'}>
                        ×{weight.toFixed(2)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No feedback yet, so every source is neutral (×1.00).</p>
              )}
            </Card>
          </div>

          <Card
            title={`Ranking model history (${versions.length} version${
              versions.length === 1 ? '' : 's'
            })`}
            description="What changed, when, and which feedback caused it."
            testId="ranking-versions"
          >
            {versions.length ? (
              <ol className="version-list">
                {versions.map((version) => (
                  <li key={version.version} data-testid={`ranking-version-${version.version}`}>
                    <div className="version-list__head">
                      <strong>Version {version.version}</strong>
                      <span className="muted">
                        {version.createdByEmail ?? 'system'} · {formatRelative(version.createdAt)}
                      </span>
                    </div>
                    <ul className="explanation-list">
                      {version.changeSummary.map((line, index) => (
                        <li key={`${index}-${line}`}>{line}</li>
                      ))}
                    </ul>
                    {version.feedback.length ? (
                      <ul className="chip-list">
                        {version.feedback.map((entry) => (
                          <li key={entry.id} className="chip">
                            {entry.missing
                              ? `feedback #${entry.id} (deleted)`
                              : `#${entry.id} ${
                                  entry.relevant === null
                                    ? 'unrated'
                                    : entry.relevant
                                      ? 'relevant'
                                      : 'irrelevant'
                                } by ${entry.actorEmail ?? 'unknown'}`}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">No feedback was consumed by this version.</p>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No ranking model version has been created yet.</p>
            )}
          </Card>

          <Card
            title="Recorded feedback"
            description={`${formatNumber(data.pendingCount)} entr${
              data.pendingCount === 1 ? 'y' : 'ies'
            } not yet captured in a model version.`}
            testId="feedback-list"
          >
            {data.feedback.length ? (
              <ul className="feedback-list">
                {data.feedback.map((entry) => (
                  <li
                    key={entry.id}
                    className={
                      focusNeed && String(entry.needId) === focusNeed
                        ? 'feedback-item is-focused'
                        : 'feedback-item'
                    }
                    data-testid="feedback-item"
                  >
                    <div className="feedback-item__head">
                      <Badge tone={entry.relevant === false ? 'negative' : 'positive'}>
                        {entry.relevant === null ? 'unrated' : entry.relevant ? 'relevant' : 'irrelevant'}
                      </Badge>
                      <strong>
                        {entry.targetType === 'need'
                          ? entry.needTitle ?? `Need #${entry.needId}`
                          : entry.evidencePreview
                            ? `“${entry.evidencePreview}…”`
                            : `Evidence #${entry.sourceRecordId}`}
                      </strong>
                      {entry.needId ? (
                        <Link className="btn btn--link" to={`/needs/${entry.needId}`}>
                          Open need
                        </Link>
                      ) : null}
                    </div>
                    <div className="feedback-item__meta">
                      <span>{entry.actorEmail ?? 'unknown reviewer'}</span>
                      <span>{formatRelative(entry.createdAt)}</span>
                      {entry.platform ? <span>source: {titleCase(entry.platform)}</span> : null}
                      <span>
                        {entry.appliedInVersions.length
                          ? `applied in v${entry.appliedInVersions.join(', v')}`
                          : 'not yet applied'}
                      </span>
                      {entry.willingnessToPay ? <span>willing to pay</span> : null}
                      {entry.contacted ? <span>contacted</span> : null}
                    </div>
                    {entry.note ? <p className="feedback-item__note">“{entry.note}”</p> : null}
                    {entry.phrases.length ? (
                      <ul className="chip-list">
                        {entry.phrases.map((phrase) => (
                          <li key={phrase} className="chip">
                            {phrase}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No feedback recorded yet" icon="◎">
                <p>
                  Open a <Link to="/needs">need</Link> and mark it relevant or irrelevant to teach
                  the ranking model.
                </p>
              </EmptyState>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
