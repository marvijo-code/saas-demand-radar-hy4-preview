import type { EngagementCounts } from '@sdr/shared';
import type { ReactNode } from 'react';

export const WINDOWS = [
  { key: '24h', label: '24h', long: 'Last 24 hours' },
  { key: '7d', label: '7d', long: 'Last 7 days' },
  { key: '30d', label: '30d', long: 'Last 30 days' },
  { key: 'all', label: 'All', long: 'All time' },
] as const;

export const SORTS = [
  { key: 'score', label: 'Demand score' },
  { key: 'recency', label: 'Most recent' },
  { key: 'frequency', label: 'Most evidence' },
  { key: 'engagement', label: 'Most engagement' },
  { key: 'title', label: 'Title A–Z' },
] as const;

export const STATUSES = ['new', 'reviewing', 'validated', 'dismissed'] as const;

export const PLATFORM_LABELS: Record<string, string> = {
  x: 'X',
  reddit: 'Reddit',
};

export const SIGNAL_LABELS: Record<string, string> = {
  buying_intent: 'Explicit buying intent',
  tool_request: 'Request for a tool',
  workaround: 'Recurring workaround',
  price_complaint: 'Price complaint',
  recurring_pain: 'Repeated operational pain',
};

export const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  validated: 'Validated',
  dismissed: 'Dismissed',
};

export function classNames(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatScore(value: number): string {
  return value.toFixed(1);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return '—';
  const diffMinutes = Math.round((Date.now() - target) / 60_000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const hours = Math.round(diffMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 18) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export function engagementLabel(engagement: EngagementCounts): string {
  const entries = Object.entries(engagement).filter(([, value]) => typeof value === 'number');
  if (!entries.length) return 'No engagement data';
  return entries
    .map(([key, value]) => `${formatNumber(value)} ${key}`)
    .join(' · ');
}

export function engagementTotal(engagement: EngagementCounts): number {
  return Object.values(engagement).reduce(
    (sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0),
    0,
  );
}

export function trendLabel(date: string): string {
  if (date.length <= 10) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }
  const parsed = new Date(`${date}:00:00Z`);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString('en-US', { hour: 'numeric' });
  }
  return date;
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function EmptyState({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="empty-state" role="status">
      {icon ? (
        <div className="empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="empty-state__title">{title}</h3>
      {children ? <div className="empty-state__body">{children}</div> : null}
    </div>
  );
}
