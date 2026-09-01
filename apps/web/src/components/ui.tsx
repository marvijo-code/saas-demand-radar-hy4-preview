import type { ReactNode } from 'react';
import { classNames } from '../lib/format.tsx';

export function Card({
  title,
  description,
  actions,
  children,
  testId,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <section className={classNames('card', className)} data-testid={testId}>
      {title || actions ? (
        <header className="card__header">
          <div>
            {title ? <h2 className="card__title">{title}</h2> : null}
            {description ? <p className="card__description">{description}</p> : null}
          </div>
          {actions ? <div className="card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="card__body">{children}</div>
    </section>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'info';
  title?: string;
}) {
  return (
    <span className={classNames('badge', `badge--${tone}`)} title={title}>
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string | number;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="stat" data-testid={testId}>
      <p className="stat__label">{label}</p>
      <p className="stat__value">{value}</p>
      {hint ? <p className="stat__hint">{hint}</p> : null}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorBlock({
  title = 'Something went wrong',
  error,
  onRetry,
}: {
  title?: string;
  error: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-block" role="alert">
      <div>
        <h3>{title}</h3>
        <p>{error}</p>
      </div>
      {onRetry ? (
        <button type="button" className="btn btn--ghost" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function ScoreMeter({ score, label }: { score: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div
      className="score-meter"
      role="meter"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? `Demand score ${clamped} out of 100`}
    >
      <div className="score-meter__track">
        <div className="score-meter__fill" style={{ width: `${clamped}%` }} />
      </div>
      <span className="score-meter__value">{clamped.toFixed(1)}</span>
    </div>
  );
}
