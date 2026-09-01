import type { WindowKey } from './types.ts';

const WINDOW_HOURS: Record<Exclude<WindowKey, 'all'>, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

export function windowStartIso(window: WindowKey, now: Date = new Date()): string | null {
  if (window === 'all') return null;
  const hours = WINDOW_HOURS[window];
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

export function isWithinWindow(isoDate: string, startIso: string | null): boolean {
  if (!startIso) return true;
  const value = Date.parse(isoDate);
  if (Number.isNaN(value)) return false;
  return value >= Date.parse(startIso);
}

/** Parses the `window` query parameter, falling back to a safe default. */
export function parseWindow(value: unknown): WindowKey {
  if (value === '24h' || value === '7d' || value === '30d') return value;
  return 'all';
}

/**
 * Resolves the "now" used for time-window filtering.
 *
 * Tests pin `now` (query parameter `now=<ISO date>`) so window boundaries stay deterministic
 * even though the bundled snapshot contains historic records. Production callers omit it.
 */
export function resolveNow(value: unknown): Date {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  return new Date();
}
