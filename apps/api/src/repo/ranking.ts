import { all, get, run } from '../db/connection.ts';
import type { RankingWeights } from '@sdr/shared';
import { DEFAULT_WEIGHTS } from '@sdr/shared';

export interface RankingModelRow {
  id: number;
  workspace_id: string;
  version: number;
  weights: string;
  phrase_weights: string;
  source_weights: string;
  change_summary: string;
  feedback_ids: string;
  created_by: string | null;
  created_at: string;
}

export interface RankingModel {
  id: number;
  version: number;
  weights: RankingWeights;
  phraseWeights: Record<string, number>;
  sourceWeights: Record<string, number>;
  changeSummary: string[];
  feedbackIds: number[];
  createdByEmail: string | null;
  createdAt: string;
}

export function parseModel(row: RankingModelRow, email: string | null = null): RankingModel {
  return {
    id: row.id,
    version: row.version,
    weights: { ...DEFAULT_WEIGHTS, ...(safeJson<RankingWeights>(row.weights) ?? {}) },
    phraseWeights: safeJson<Record<string, number>>(row.phrase_weights) ?? {},
    sourceWeights: safeJson<Record<string, number>>(row.source_weights) ?? {},
    changeSummary: safeJson<string[]>(row.change_summary) ?? [],
    feedbackIds: safeJson<number[]>(row.feedback_ids) ?? [],
    createdByEmail: email,
    createdAt: row.created_at,
  };
}

function safeJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function latestModel(workspaceId: string): RankingModel | null {
  const row = get<RankingModelRow & { email: string | null }>(
    `SELECT m.*, u.email AS email
     FROM ranking_models m
     LEFT JOIN users u ON u.id = m.created_by
     WHERE m.workspace_id = ?
     ORDER BY m.version DESC
     LIMIT 1`,
    workspaceId,
  );
  return row ? parseModel(row, row.email) : null;
}

export function listModels(workspaceId: string): RankingModel[] {
  const rows = all<RankingModelRow & { email: string | null }>(
    `SELECT m.*, u.email AS email
     FROM ranking_models m
     LEFT JOIN users u ON u.id = m.created_by
     WHERE m.workspace_id = ?
     ORDER BY m.version DESC`,
    workspaceId,
  );
  return rows.map((row) => parseModel(row, row.email));
}

export function insertModel(input: {
  workspaceId: string;
  version: number;
  weights: RankingWeights;
  phraseWeights: Record<string, number>;
  sourceWeights: Record<string, number>;
  changeSummary: string[];
  feedbackIds: number[];
  createdBy: string | null;
}): RankingModel {
  const now = new Date().toISOString();
  const result = run(
    `INSERT INTO ranking_models
       (workspace_id, version, weights, phrase_weights, source_weights, change_summary, feedback_ids, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.workspaceId,
    input.version,
    JSON.stringify(input.weights),
    JSON.stringify(input.phraseWeights),
    JSON.stringify(input.sourceWeights),
    JSON.stringify(input.changeSummary),
    JSON.stringify(input.feedbackIds),
    input.createdBy,
    now,
  );
  const row = get<RankingModelRow>('SELECT * FROM ranking_models WHERE id = ?', Number(result.lastInsertRowid));
  if (!row) throw new Error('failed to insert ranking model');
  return parseModel(row);
}

export function ensureInitialModel(workspaceId: string, createdBy: string | null): RankingModel {
  const existing = latestModel(workspaceId);
  if (existing) return existing;
  return insertModel({
    workspaceId,
    version: 1,
    weights: { ...DEFAULT_WEIGHTS },
    phraseWeights: {},
    sourceWeights: {},
    changeSummary: ['Initial ranking model created from the default weights.'],
    feedbackIds: [],
    createdBy,
  });
}

export function listPhraseWeights(workspaceId: string): Record<string, number> {
  const rows = all<{ phrase: string; weight: number }>(
    'SELECT phrase, weight FROM phrase_weights WHERE workspace_id = ? ORDER BY phrase',
    workspaceId,
  );
  return Object.fromEntries(rows.map((row) => [row.phrase, row.weight]));
}

export function listSourceWeights(workspaceId: string): Record<string, number> {
  const rows = all<{ platform: string; weight: number }>(
    'SELECT platform, weight FROM source_weights WHERE workspace_id = ? ORDER BY platform',
    workspaceId,
  );
  return Object.fromEntries(rows.map((row) => [row.platform, row.weight]));
}

export function replacePhraseWeights(workspaceId: string, weights: Record<string, number>): void {
  const now = new Date().toISOString();
  run('DELETE FROM phrase_weights WHERE workspace_id = ?', workspaceId);
  for (const [phrase, weight] of Object.entries(weights)) {
    run(
      'INSERT INTO phrase_weights (workspace_id, phrase, weight, updated_at) VALUES (?, ?, ?, ?)',
      workspaceId,
      phrase,
      weight,
      now,
    );
  }
}

export function replaceSourceWeights(workspaceId: string, weights: Record<string, number>): void {
  const now = new Date().toISOString();
  run('DELETE FROM source_weights WHERE workspace_id = ?', workspaceId);
  for (const [platform, weight] of Object.entries(weights)) {
    run(
      'INSERT INTO source_weights (workspace_id, platform, weight, updated_at) VALUES (?, ?, ?, ?)',
      workspaceId,
      platform,
      weight,
      now,
    );
  }
}
