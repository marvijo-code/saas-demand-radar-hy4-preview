import type { RawSourceRecord } from '@sdr/shared';

export interface AdapterContext {
  workspaceId: string;
  keywords: string[];
  subreddits: string[];
  maxResults: number;
  /** Records supplied inline by the caller (used by the deterministic snapshot adapter). */
  records?: unknown;
  /** Optional override for the snapshot file. */
  snapshotPath?: string;
}

export interface AdapterError {
  index: number;
  message: string;
}

export interface AdapterResult {
  records: RawSourceRecord[];
  /** Human readable notes shown in the source-run detail view. */
  notes: string[];
  /** Per-record validation problems. Ingestion keeps going and reports them. */
  errors?: AdapterError[];
  /** Credentials needed but missing: the route answers 503 with `unavailable`. */
  unavailable?: { message: string; hint: string };
}

export interface AdapterDescriptor {
  id: string;
  label: string;
  /** True when the adapter can run in this environment without extra credentials. */
  ready: boolean;
  limits: string[];
}

/**
 * Replaceable source adapter.
 *
 * The pipeline only ever talks to this interface, so a real X or Reddit credential can be
 * dropped in later without touching ingestion, grouping or scoring.
 */
export interface SourceAdapter {
  readonly id: string;
  readonly label: string;
  describe(): AdapterDescriptor;
  fetch(ctx: AdapterContext): Promise<AdapterResult>;
}
