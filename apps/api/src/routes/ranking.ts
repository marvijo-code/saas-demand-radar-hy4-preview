import { Router } from 'express';
import { asyncHandler, ok } from '../lib/http.ts';
import { auth, requireAuth } from '../auth/session.ts';
import { rescoreWorkspace } from '../pipeline/learning.ts';
import { listModels, listPhraseWeights, listSourceWeights } from '../repo/ranking.ts';
import { listWorkspaceFeedback } from '../repo/feedback.ts';
import { recordAudit } from '../repo/audit.ts';

export const rankingRouter = Router();

/**
 * Creates a new ranking-model version from the feedback recorded since the previous version.
 * Returns every rank and score change so the UI can show what the feedback actually did.
 */
rankingRouter.post(
  '/rescore',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const result = rescoreWorkspace(context.workspace.id, {
      userId: context.user.id,
      email: context.user.email,
    });
    recordAudit({
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      actorEmail: context.user.email,
      action: 'ranking.rescored',
      targetType: 'ranking_model',
      targetId: result.version,
      summary: `Created ranking model version ${result.version} from ${result.feedbackApplied.length} feedback entr${
        result.feedbackApplied.length === 1 ? 'y' : 'ies'
      }.`,
      metadata: { changes: result.changes.slice(0, 10), summary: result.model.changeSummary },
    });
    return ok(res, {
      version: result.version,
      previousVersion: result.previousVersion,
      changes: result.changes,
      changeSummary: result.model.changeSummary,
      feedbackApplied: result.feedbackApplied,
      phraseWeights: result.phraseWeights,
      sourceWeights: result.sourceWeights,
      model: {
        version: result.model.version,
        weights: result.model.weights,
        changeSummary: result.model.changeSummary,
        feedbackIds: result.model.feedbackIds,
        createdByEmail: context.user.email,
        createdAt: result.model.createdAt,
      },
    });
  }),
);

/** Versioned model history with the provenance of every version. */
rankingRouter.get(
  '/versions',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const models = listModels(context.workspace.id);
    const feedbackById = new Map(
      listWorkspaceFeedback(context.workspace.id, 1_000).map((entry) => [entry.id, entry]),
    );
    return ok(res, {
      versions: models.map((model) => ({
        version: model.version,
        weights: model.weights,
        phraseWeights: model.phraseWeights,
        sourceWeights: model.sourceWeights,
        changeSummary: model.changeSummary,
        createdByEmail: model.createdByEmail,
        createdAt: model.createdAt,
        feedback: model.feedbackIds.map((id) => {
          const entry = feedbackById.get(id);
          if (!entry) return { id, missing: true };
          return {
            id,
            targetType: entry.target_type,
            needId: entry.need_id,
            sourceRecordId: entry.source_record_id,
            relevant: entry.relevant === null ? null : entry.relevant === 1,
            willingnessToPay: entry.willingness_to_pay === 1,
            contacted: entry.contacted === 1,
            note: entry.note,
            actorEmail: entry.actor_email,
            createdAt: entry.created_at,
          };
        }),
      })),
      current: {
        phraseWeights: listPhraseWeights(context.workspace.id),
        sourceWeights: listSourceWeights(context.workspace.id),
      },
    });
  }),
);
