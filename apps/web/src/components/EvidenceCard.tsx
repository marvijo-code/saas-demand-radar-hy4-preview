import { SIGNAL_LABELS } from '@sdr/shared';
import type { SignalKind } from '@sdr/shared';
import type { NeedEvidenceItem, FeedbackEntry } from '../lib/api.ts';
import { Badge } from './ui.tsx';
import { PLATFORM_LABELS, engagementLabel, formatDate, formatRelative } from '../lib/format.tsx';

export interface EvidenceFeedbackHandler {
  (record: NeedEvidenceItem, decision: {
    relevant?: boolean | null;
    willingnessToPay?: boolean;
    contacted?: boolean;
  }): void;
}

/**
 * One public source record.
 *
 * Source text is rendered as text only: React escapes it, so a post can never be executed as
 * HTML, and the original public URL is always shown so the evidence can be verified.
 */
export function EvidenceCard({
  evidence,
  onFeedback,
  busy,
}: {
  evidence: NeedEvidenceItem;
  onFeedback?: EvidenceFeedbackHandler;
  busy?: boolean;
}) {
  const latest = evidence.feedback[0] ?? null;
  return (
    <article className="evidence" data-testid={`evidence-${evidence.sourceRecordId}`}>
      <header className="evidence__header">
        <div className="evidence__meta">
          <Badge tone={evidence.platform === 'x' ? 'info' : 'warning'}>
            {PLATFORM_LABELS[evidence.platform] ?? evidence.platform}
          </Badge>
          {evidence.subreddit ? <Badge>{evidence.subreddit}</Badge> : null}
          <span className="muted">
            {evidence.author ? `u/${evidence.author.replace(/^u\//, '')}` : 'unknown author'}
          </span>
          <span className="muted">{formatDate(evidence.publishedAt)}</span>
        </div>
        <a
          className="evidence__link"
          href={evidence.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          View original ↗
        </a>
      </header>

      <blockquote className="evidence__text">{evidence.text}</blockquote>

      {evidence.signals.length ? (
        <ul className="signal-list">
          {evidence.signals.map((signal, index) => (
            <li key={`${signal.kind}-${index}`}>
              <Badge tone="positive">
                {SIGNAL_LABELS[signal.kind as SignalKind] ?? signal.kind}
              </Badge>
              <span className="signal-list__phrase">“{signal.matchedPhrase}”</span>
              <span className="muted">{Math.round(signal.strength * 100)}% confidence</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No demand-signal language detected in this record.</p>
      )}

      <footer className="evidence__footer">
        <span className="muted">{engagementLabel(evidence.engagement)}</span>
        {onFeedback ? (
          <div className="evidence__actions">
            <button
              type="button"
              className="btn btn--small"
              disabled={busy}
              aria-label={`Mark evidence from ${evidence.platform} as relevant`}
              onClick={() => onFeedback(evidence, { relevant: true })}
            >
              Relevant
            </button>
            <button
              type="button"
              className="btn btn--small"
              disabled={busy}
              aria-label={`Mark evidence from ${evidence.platform} as irrelevant`}
              onClick={() => onFeedback(evidence, { relevant: false })}
            >
              Irrelevant
            </button>
            <button
              type="button"
              className="btn btn--small"
              disabled={busy}
              onClick={() => onFeedback(evidence, { willingnessToPay: true })}
            >
              Willing to pay
            </button>
            <button
              type="button"
              className="btn btn--small"
              disabled={busy}
              onClick={() => onFeedback(evidence, { contacted: true })}
            >
              Contacted
            </button>
          </div>
        ) : null}
      </footer>

      {latest ? <FeedbackTrail entry={latest} /> : null}
    </article>
  );
}

export function FeedbackTrail({ entry }: { entry: FeedbackEntry }) {
  return (
    <p className="evidence__feedback">
      Latest review by {entry.actorEmail ?? 'a reviewer'}:{' '}
      <strong>
        {entry.relevant === null ? 'unrated' : entry.relevant ? 'relevant' : 'irrelevant'}
      </strong>
      {entry.willingnessToPay ? ' · willing to pay' : ''}
      {entry.contacted ? ' · contacted' : ''}
      {entry.note ? ` · “${entry.note}”` : ''} · {formatRelative(entry.createdAt)}
    </p>
  );
}
