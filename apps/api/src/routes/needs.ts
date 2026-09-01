import { Router } from 'express';
import { NEED_STATUSES } from '@sdr/shared';
import type { NeedStatus } from '@sdr/shared';
import { asyncHandler, notFoundError, ok } from '../lib/http.ts';
import { asBoolean, asEnum, asObject, asOptionalBoolean, asOptionalString } from '../lib/validate.ts';
import { auth, requireAuth } from '../auth/session.ts';
import { getNeedDetail, parseNeedsQuery, queryNeeds } from '../pipeline/query.ts';
import { getNeedRow, updateNeedStatus } from '../repo/needs.ts';
import { getRecordById } from '../repo/records.ts';
import { insertFeedback } from '../repo/feedback.ts';
import { recordAudit } from '../repo/audit.ts';
import { refreshLearnedWeights } from '../pipeline/learning.ts';
import { loadGraph } from '../pipeline/graph.ts';

export const needsRouter = Router();

/** Paginated, filtered and sorted needs list. */
needsRouter.get(
  '/',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const query = parseNeedsQuery(req.query as Record<string, unknown>);
    const result = queryNeeds(context.workspace.id, query);
    return ok(res, result);
  }),
);

needsRouter.get(
  '/:id',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id)) throw notFoundError('Need not found.');
    const query = parseNeedsQuery(req.query as Record<string, unknown>);
    const detail = getNeedDetail(context.workspace.id, id, query);
    if (!detail) throw notFoundError('Need not found.');
    return ok(res, { need: detail, window: query.window });
  }),
);

/** Reviewers move a need through `new → reviewing → validated / dismissed`. */
needsRouter.patch(
  '/:id/status',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const id = Number.parseInt(String(req.params.id), 10);
    const body = asObject(req.body);
    const status = asEnum<NeedStatus>(body.status, 'status', NEED_STATUSES);
    const row = getNeedRow(context.workspace.id, id);
    if (!row) throw notFoundError('Need not found.');
    updateNeedStatus(context.workspace.id, id, status);
    recordAudit({
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      actorEmail: context.user.email,
      action: 'need.status_changed',
      targetType: 'need',
      targetId: id,
      summary: `Need "${row.title}" moved from ${row.status} to ${status}.`,
      metadata: { from: row.status, to: status },
    });
    return ok(res, { id, status });
  }),
);

export interface FeedbackBody {
  relevant: boolean | null;
  willingnessToPay: boolean;
  contacted: boolean;
  note: string | null;
}

export function readFeedbackBody(body: Record<string, unknown>): FeedbackBody {
  return {
    relevant: asOptionalBoolean(body.relevant, 'relevant'),
    willingnessToPay: asBoolean(body.willingnessToPay ?? body.willingness_to_pay, 'willingnessToPay'),
    contacted: asBoolean(body.contacted, 'contacted'),
    note: asOptionalString(body.note, 'note', { max: 1_000 }),
  };
}

/**
 * Reviewer feedback on a whole need.
 *
 * The decision is stored immediately and the learned phrase/source weights are refreshed in
 * the same request, so the needs list reflects it without waiting for a re-score.
 */
needsRouter.post(
  '/:id/feedback',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const id = Number.parseInt(String(req.params.id), 10);
    const need = getNeedRow(context.workspace.id, id);
    if (!need) throw notFoundError('Need not found.');
    const input = readFeedbackBody(asObject(req.body));

    const row = insertFeedback({
      workspaceId: context.workspace.id,
      userId: context.user.id,
      targetType: 'need',
      needId: id,
      sourceRecordId: null,
      relevant: input.relevant,
      willingnessToPay: input.willingnessToPay,
      contacted: input.contacted,
      note: input.note,
    });
    const weights = refreshLearnedWeights(context.workspace.id);
    recordAudit({
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      actorEmail: context.user.email,
      action: 'feedback.created',
      targetType: 'need',
      targetId: id,
      summary: `${context.user.email} reviewed need "${need.title}" as ${
        input.relevant === null ? 'unrated' : input.relevant ? 'relevant' : 'irrelevant'
      }.`,
      metadata: {
        feedbackId: row.id,
        relevant: input.relevant,
        willingnessToPay: input.willingnessToPay,
        contacted: input.contacted,
      },
    });
    return res.status(201).json({
      feedback: {
        id: row.id,
        targetType: row.target_type,
        needId: row.need_id,
        sourceRecordId: row.source_record_id,
        relevant: row.relevant === null ? null : row.relevant === 1,
        willingnessToPay: row.willingness_to_pay === 1,
        contacted: row.contacted === 1,
        note: row.note,
        createdAt: row.created_at,
      },
      weights,
    });
  }),
);

/** Reviewer feedback on a single piece of evidence belonging to a need. */
needsRouter.post(
  '/:id/evidence/:recordId/feedback',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const needId = Number.parseInt(String(req.params.id), 10);
    const recordId = Number.parseInt(String(req.params.recordId), 10);
    const need = getNeedRow(context.workspace.id, needId);
    if (!need) throw notFoundError('Need not found.');
    const record = getRecordById(context.workspace.id, recordId);
    if (!record) throw notFoundError('Evidence not found in this workspace.');
    const input = readFeedbackBody(asObject(req.body));
    const row = insertFeedback({
      workspaceId: context.workspace.id,
      userId: context.user.id,
      targetType: 'evidence',
      needId: needId,
      sourceRecordId: recordId,
      relevant: input.relevant,
      willingnessToPay: input.willingnessToPay,
      contacted: input.contacted,
      note: input.note,
    });
    const weights = refreshLearnedWeights(context.workspace.id);
    recordAudit({
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      actorEmail: context.user.email,
      action: 'feedback.created',
      targetType: 'evidence',
      targetId: recordId,
      summary: `${context.user.email} reviewed evidence #${recordId} (${record.platform}) of need "${need.title}".`,
      metadata: { feedbackId: row.id, needId },
    });
    return res.status(201).json({
      feedback: {
        id: row.id,
        targetType: row.target_type,
        needId: row.need_id,
        sourceRecordId: row.source_record_id,
        relevant: row.relevant === null ? null : row.relevant === 1,
        willingnessToPay: row.willingness_to_pay === 1,
        contacted: row.contacted === 1,
        note: row.note,
        createdAt: row.created_at,
      },
      weights,
    });
  }),
);

/** Lightweight list of every source record, used by the feedback screen's evidence picker. */
needsRouter.get(
  '/evidence/all',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const graph = loadGraph(context.workspace.id);
    return ok(res, {
      records: graph.records.map((record) => ({
        id: record.id,
        platform: record.platform,
        externalId: record.externalId,
        url: record.url,
        author: record.author,
        publishedAt: record.publishedAt,
        text: record.text,
        signals: record.signals,
      })),
    });
  }),
);
