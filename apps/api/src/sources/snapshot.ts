import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RawSourceRecord } from '@sdr/shared';
import { config } from '../config.ts';
import { normalizeRecords, RecordValidationError } from './normalize.ts';
import type { AdapterContext, AdapterDescriptor, AdapterResult, SourceAdapter } from './types.ts';

export interface SnapshotFile {
  schemaVersion?: number;
  capturedAt?: string;
  records: unknown;
}

export function loadSnapshot(path: string): SnapshotFile {
  const full = resolve(path);
  const parsed = JSON.parse(readFileSync(full, 'utf8')) as SnapshotFile;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.records)) {
    throw new RecordValidationError(`Snapshot file ${path} must contain a "records" array.`);
  }
  return parsed;
}

export function snapshotRecords(input: { records?: unknown; snapshotPath?: string }): {
  records: RawSourceRecord[];
  errors: { index: number; message: string }[];
  notes: string[];
  source: string;
} {
  const notes: string[] = [];
  let raw: unknown;
  let source: string;
  if (input.records !== undefined) {
    raw = input.records;
    source = 'inline request payload';
  } else {
    const path = input.snapshotPath ?? config.snapshotPath;
    const file = loadSnapshot(path);
    raw = file.records;
    source = path;
    if (file.capturedAt) notes.push(`Snapshot captured at ${file.capturedAt}.`);
  }
  const { records, errors } = normalizeRecords(raw);
  notes.push(`Loaded ${records.length} record(s) from ${source}.`);
  return { records, errors, notes, source };
}

/**
 * Deterministic adapter used by the acceptance suite and by local development.
 * It never calls a network service and never invents data.
 */
export const snapshotAdapter: SourceAdapter = {
  id: 'snapshot',
  label: 'Deterministic snapshot',
  describe(): AdapterDescriptor {
    return {
      id: 'snapshot',
      label: 'Deterministic snapshot',
      ready: true,
      limits: [
        'Returns only the records contained in the snapshot file or request payload.',
        'No network access and no pagination: the snapshot is the whole corpus.',
        'Ideal for tests and demos because the output is byte-for-byte reproducible.',
      ],
    };
  },
  async fetch(ctx: AdapterContext): Promise<AdapterResult> {
    const { records, errors, notes } = snapshotRecords({
      records: ctx.records,
      snapshotPath: ctx.snapshotPath,
    });
    return { records, notes, errors };
  },
};
