import { Router } from 'express';
import type { RawSourceRecord } from '@sdr/shared';
import { config } from '../config.ts';
import { asyncHandler, invalid, ok } from '../lib/http.ts';
import { asEnum, asObject, asOptionalString, asStringArray } from '../lib/validate.ts';
import { auth, requireAuth } from '../auth/session.ts';
import { ADAPTER_IDS, getAdapter } from '../sources/registry.ts';
import { runIngest } from '../pipeline/ingest.ts';
import { sendIngestResult } from './ingest-result.ts';

export const sourcesRouter = Router();

/**
 * Ingestion entry point.
 *
 * `{ "adapter": "snapshot", "records": [...] }` ingests the supplied records deterministically.
 * Omitting `records` makes the adapter read the snapshot file, and choosing the `x` or
 * `reddit` adapter runs the live adapter (which reports a clear 503 when it is not
 * configured instead of fabricating data).
 */
sourcesRouter.post(
  '/ingest',
  requireAuth,
  asyncHandler(async (req, res) => {
    const context = auth(req);
    const body = asObject(req.body);
    const adapter = asEnum(body.adapter, 'adapter', ADAPTER_IDS, { fallback: 'snapshot' });
    const keywords = asStringArray(body.keywords, 'keywords');
    const subreddits = asStringArray(body.subreddits, 'subreddits');
    const snapshotPath = asOptionalString(body.snapshotPath ?? body.snapshot_path, 'snapshotPath', {
      max: 500,
    });

    let records: unknown = body.records;
    if (records !== undefined && !Array.isArray(records)) {
      throw invalid('`records` must be an array when provided.');
    }
    if (records !== undefined && (records as unknown[]).length > config.maxIngestRecords) {
      throw invalid(`\`records\` must contain at most ${config.maxIngestRecords} entries.`);
    }
    if (records !== undefined) {
      records = records as RawSourceRecord[];
    }

    const summary = await runIngest({
      workspaceId: context.workspace.id,
      adapter,
      actorUserId: context.user.id,
      actorEmail: context.user.email,
      trigger: 'manual',
      records,
      snapshotPath: snapshotPath ?? undefined,
      keywords,
      subreddits,
    });

    return sendIngestResult(res, summary);
  }),
);

/** Describes each adapter, whether it can run here, and its limits. */
sourcesRouter.get(
  '/adapters',
  requireAuth,
  asyncHandler((req, res) => {
    const requested = getAdapter(String(req.query.adapter ?? ''));
    if (requested) return ok(res, { adapter: requested.describe() });
    return ok(res, {
      adapters: ADAPTER_IDS.map((id) => getAdapter(id)?.describe()).filter(Boolean),
    });
  }),
);
