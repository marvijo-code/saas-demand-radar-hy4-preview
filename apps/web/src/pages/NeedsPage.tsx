import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type NeedsResponse, type NeedSummary } from '../lib/api.ts';
import { Badge, Card, ErrorBlock, ScoreMeter, Spinner } from '../components/ui.tsx';
import {
  EmptyState,
  PLATFORM_LABELS,
  SIGNAL_LABELS,
  SORTS,
  STATUSES,
  STATUS_LABELS,
  WINDOWS,
  classNames,
  formatNumber,
  formatRelative,
  formatScore,
} from '../lib/format.tsx';

export function NeedsPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<NeedsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const window = params.get('window') ?? 'all';
  const search = params.get('search') ?? '';
  const platform = params.get('platform') ?? 'all';
  const status = params.get('status') ?? 'all';
  const sort = params.get('sort') ?? 'score';
  const page = Number(params.get('page') ?? 1) || 1;
  const pageSize = Number(params.get('pageSize') ?? 12) || 12;
  const [searchDraft, setSearchDraft] = useState(search);

  const query = useMemo(
    () => ({ window, search, platform, status, sort, page, pageSize }),
    [window, search, platform, status, sort, page, pageSize],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.needs(query));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load needs.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    document.title = 'Needs · SaaS Demand Radar';
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function update(patch: Record<string, string | number | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '' || value === 'all') next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  }

  return (
    <div className="page" data-testid="needs-list">
      <header className="page__header">
        <div>
          <h1>Needs</h1>
          <p className="page__subtitle">
            Grouped SaaS demand, ranked by frequency, recency, intent, engagement and
            cross-source diversity.
          </p>
        </div>
        <div className="page__actions">
          <span className="muted">
            {data ? `${formatNumber(data.total)} need${data.total === 1 ? '' : 's'}` : '—'}
            {data ? ` · model v${data.modelVersion}` : ''}
          </span>
        </div>
      </header>

      <Card className="filters" testId="needs-filters">
        <div className="filters__row">
          <fieldset className="filters__group">
            <legend>Time window</legend>
            <div className="segmented" role="group" aria-label="Time window">
              {WINDOWS.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className={classNames('segmented__item', window === entry.key && 'is-active')}
                  aria-pressed={window === entry.key}
                  data-testid={`window-${entry.key}`}
                  onClick={() => update({ window: entry.key })}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="field field--inline">
            <label htmlFor="needs-sort">Sort by</label>
            <select
              id="needs-sort"
              value={sort}
              onChange={(event) => update({ sort: event.target.value })}
            >
              {SORTS.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field field--inline">
            <label htmlFor="needs-platform">Platform</label>
            <select
              id="needs-platform"
              value={platform}
              onChange={(event) => update({ platform: event.target.value })}
            >
              <option value="all">All platforms</option>
              <option value="x">X only</option>
              <option value="reddit">Reddit only</option>
            </select>
          </div>

          <div className="field field--inline">
            <label htmlFor="needs-status">Status</label>
            <select
              id="needs-status"
              value={status}
              onChange={(event) => update({ status: event.target.value })}
            >
              <option value="all">Any status</option>
              {STATUSES.map((entry) => (
                <option key={entry} value={entry}>
                  {STATUS_LABELS[entry]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="filters__row">
          <form
            className="field field--grow"
            onSubmit={(event) => {
              event.preventDefault();
              update({ search: searchDraft });
            }}
          >
            <label htmlFor="needs-search">Search evidence</label>
            <div className="input-row">
              <input
                id="needs-search"
                type="search"
                value={searchDraft}
                placeholder="Search titles and public source text"
                onChange={(event) => setSearchDraft(event.target.value)}
              />
              <button type="submit" className="btn btn--primary">
                Search
              </button>
              {search ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setSearchDraft('');
                    update({ search: '' });
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </Card>

      {/* Only the very first load replaces the list with a spinner: re-filtering keeps the
          previous results on screen (with an aria-busy hint) so the page never flickers. */}
      {loading && !data ? <Spinner label="Ranking needs…" /> : null}
      {error ? <ErrorBlock error={error} onRetry={() => void load()} /> : null}
      {loading && data ? (
        <p className="muted" role="status">
          Updating results…
        </p>
      ) : null}

      {data ? (
        data.needs.length === 0 ? (
          <EmptyState
            title={
              data.totals.records === 0
                ? 'No source records ingested yet'
                : 'No needs match these filters'
            }
            icon="◎"
          >
            {data.totals.records === 0 ? (
              <p>
                Ingest public records from the <Link to="/sources">Source runs</Link> page first.
                Nothing is generated from thin air.
              </p>
            ) : (
              <p>
                {formatNumber(data.totals.records)} records are stored but none match the current
                window, platform, status or search. Try widening the time window.
              </p>
            )}
          </EmptyState>
        ) : (
          <>
            <ul className="need-list" aria-busy={loading} data-testid="need-list">
              {data.needs.map((need) => (
                <NeedRow key={need.id} need={need} />
              ))}
            </ul>

            <nav className="pagination" aria-label="Needs pagination">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={page <= 1}
                onClick={() => update({ page: page - 1 })}
              >
                ← Previous
              </button>
              <span>
                Page {data.page} of {data.totalPages}
              </span>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={page >= data.totalPages}
                onClick={() => update({ page: page + 1 })}
              >
                Next →
              </button>
            </nav>
          </>
        )
      ) : null}
    </div>
  );
}

function NeedRow({ need }: { need: NeedSummary }) {
  return (
    <li className="need-card" data-testid="need-card">
      <div className="need-card__rank">
        <span className="need-card__rank-number">#{need.rank ?? '—'}</span>
        <ScoreMeter score={need.score} label={`Demand score for ${need.title}`} />
      </div>
      <div className="need-card__body">
        <h2 className="need-card__title">
          <Link to={`/needs/${need.id}`}>{need.title}</Link>
        </h2>
        <p className="need-card__summary">{need.summary}</p>
        <div className="need-card__meta">
          <Badge tone={need.status === 'validated' ? 'positive' : 'neutral'}>
            {STATUS_LABELS[need.status] ?? need.status}
          </Badge>
          {need.platforms.map((entry) => (
            <Badge key={entry} tone="info">
              {PLATFORM_LABELS[entry] ?? entry}
            </Badge>
          ))}
          <span>{need.evidenceCount} evidence</span>
          <span>{need.authors} author(s)</span>
          <span>{formatNumber(need.totalEngagement)} engagement</span>
          <span>last seen {formatRelative(need.lastSeenAt)}</span>
        </div>
        {need.signalKinds.length ? (
          <ul className="chip-list">
            {need.signalKinds.map((kind) => (
              <li key={kind} className="chip">
                {SIGNAL_LABELS[kind] ?? kind}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="need-card__score">
        <p className="need-card__score-value">{formatScore(need.score)}</p>
        <p className="muted">/ 100</p>
        {need.feedback.relevant || need.feedback.irrelevant ? (
          <p className="muted">
            {need.feedback.relevant} relevant · {need.feedback.irrelevant} irrelevant
          </p>
        ) : null}
      </div>
    </li>
  );
}
