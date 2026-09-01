import { Router } from 'express';
import { asyncHandler, ok } from '../lib/http.ts';
import { auth, requireAuth } from '../auth/session.ts';
import { listWorkspaceFeedback } from '../repo/feedback.ts';
import { latestModel, listPhraseWeights, listModels, listSourceWeights } from '../repo/ranking.ts';
import { loadGraph } from '../pipeline/graph.ts';
import { computeWeightsFromFeedback } from '../pipeline/learning.ts';

export const feedbackRouter = Router();

/**
 * Everything the "feedback learning" surface needs: every review, the learned weights and
 * which model version already consumed which feedback.
 */
feedbackRouter.get(
  '/',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const workspaceId = context.workspace.id;
    const graph = loadGraph(workspaceId);
    const contributions = computeWeightsFromFeedback(graph).contributions;
    const contributionById = new Map(contributions.map((entry) => [entry.feedbackId, entry]));
    const models = listModels(workspaceId);
    const consumedBy = new Map<number, number[]>();
    for (const model of models) {
      for (const id of model.feedbackIds) {
        consumedBy.set(id, [...(consumedBy.get(id) ?? []), model.version]);
      }
    }

    const needTitleById = new Map(graph.needs.map((need) => [need.id, need.title]));
    const recordTextById = new Map(graph.records.map((record) => [record.id, record.text]));

    return ok(res, {
      feedback: listWorkspaceFeedback(workspaceId, 500).map((entry) => ({
        id: entry.id,
        targetType: entry.target_type,
        needId: entry.need_id,
        sourceRecordId: entry.source_record_id,
        needTitle: entry.need_id ? (needTitleById.get(entry.need_id) ?? null) : null,
        evidencePreview: entry.source_record_id
          ? (recordTextById.get(entry.source_record_id) ?? '').slice(0, 160)
          : null,
        relevant: entry.relevant === null ? null : entry.relevant === 1,
        willingnessToPay: entry.willingness_to_pay === 1,
        contacted: entry.contacted === 1,
        note: entry.note,
        actorEmail: entry.actor_email,
        createdAt: entry.created_at,
        phrases: contributionById.get(entry.id)?.phrases ?? [],
        platform: contributionById.get(entry.id)?.platform ?? null,
        appliedInVersions: consumedBy.get(entry.id) ?? [],
      })),
      weights: {
        phraseWeights: listPhraseWeights(workspaceId),
        sourceWeights: listSourceWeights(workspaceId),
      },
      modelVersion: latestModel(workspaceId)?.version ?? 1,
      pendingCount: listWorkspaceFeedback(workspaceId, 500).filter(
        (entry) => !consumedBy.has(entry.id),
      ).length,
    });
  }),
);
