import type { Response } from 'express';
import type { IngestSummary } from '../pipeline/ingest.ts';

/**
 * Maps an ingestion run onto the right HTTP status.
 *
 * A run is a *job report*, not a request result: the run row is always stored, and the status
 * code only tells the caller what to do next.
 *
 * - 200  every supplied record was stored (or was already known)
 * - 422  the caller supplied records that failed validation
 * - 503  the adapter cannot run here because credentials are missing
 * - 500  the adapter itself failed (network, upstream error, unexpected crash)
 */
export function sendIngestResult(res: Response, summary: IngestSummary): Response {
  if (summary.status === 'failed') {
    if (summary.unavailable) {
      return res.status(503).json({
        error: {
          code: 'adapter_unavailable',
          message: summary.unavailable.message,
          details: { hint: summary.unavailable.hint },
        },
        run: summary,
      });
    }
    if (summary.recordsFailed > 0 && !summary.error) {
      return res.status(422).json({
        error: {
          code: 'ingest_failed',
          message: `${summary.recordsFailed} of ${summary.recordsSeen} record(s) were rejected.`,
          details: { errors: summary.errors },
        },
        run: summary,
      });
    }
    return res.status(500).json({
      error: { code: 'ingest_failed', message: summary.error?.message ?? 'Ingestion failed.' },
      run: summary,
    });
  }
  return res.status(200).json({ run: summary });
}
