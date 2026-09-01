import { jaccard, keyPhrases, titleFromText, uniqueTokens } from './tokens.ts';
import type { Platform } from './types.ts';

export interface GroupableRecord {
  recordId: number;
  platform: Platform;
  externalId: string;
  publishedAt: string;
  text: string;
  engagementTotal: number;
}

export interface NeedCluster {
  /** Stable natural key for the need. */
  key: string;
  title: string;
  phrases: string[];
  memberRecordIds: number[];
  representativeRecordId: number;
}

export interface GroupingOptions {
  /** Mean token similarity required for a record to join an existing cluster. */
  threshold?: number;
}

/**
 * Deterministic, dependency-free clustering of source records into SaaS needs.
 *
 * The default threshold (0.15) deliberately merges only records that really talk about the
 * same demanded thing: in the bundled snapshot the six public records describe six different
 * products, so forcing them together would misrepresent the evidence.
 *
 * Records are processed in a stable order (timestamp, platform, external id) and compared
 * with the *average* token similarity of the records already in a cluster (average-linkage).
 * Average linkage was chosen over single linkage because it does not chain unrelated
 * records together through one shared word.
 *
 * The cluster representative is the record with the highest engagement (ties broken by the
 * most recent timestamp and then the external id). It provides the need title and the
 * stable natural key, so re-ingesting the same records always produces the same need.
 */
export function groupRecords(
  records: GroupableRecord[],
  options: GroupingOptions = {},
): NeedCluster[] {
  const threshold = options.threshold ?? 0.15;
  const ordered = [...records].sort((a, b) => {
    const byTime = Date.parse(a.publishedAt) - Date.parse(b.publishedAt);
    if (byTime !== 0) return byTime;
    const byPlatform = a.platform.localeCompare(b.platform);
    if (byPlatform !== 0) return byPlatform;
    return a.externalId.localeCompare(b.externalId);
  });

  const clusters: { members: GroupableRecord[]; tokens: string[][] }[] = [];

  for (const record of ordered) {
    const tokens = uniqueTokens(record.text);
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < clusters.length; i += 1) {
      const candidate = clusters[i];
      let total = 0;
      for (const memberTokens of candidate.tokens) {
        total += jaccard(tokens, memberTokens);
      }
      const mean = total / candidate.tokens.length;
      if (mean > bestScore) {
        bestScore = mean;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0 && bestScore >= threshold) {
      clusters[bestIndex].members.push(record);
      clusters[bestIndex].tokens.push(tokens);
    } else {
      clusters.push({ members: [record], tokens: [tokens] });
    }
  }

  return clusters.map((cluster) => {
    const members = [...cluster.members];
    const representative = pickRepresentative(members);
    const combinedText = members
      .slice()
      .sort((a, b) => b.engagementTotal - a.engagementTotal)
      .map((member) => member.text)
      .join(' ');
    return {
      key: `${representative.platform}-${representative.externalId}`,
      title: titleFromText(representative.text),
      phrases: keyPhrases(combinedText, 8),
      memberRecordIds: members.map((member) => member.recordId).sort((a, b) => a - b),
      representativeRecordId: representative.recordId,
    };
  });
}

function pickRepresentative(members: GroupableRecord[]): GroupableRecord {
  return [...members].sort((a, b) => {
    if (b.engagementTotal !== a.engagementTotal) return b.engagementTotal - a.engagementTotal;
    const byTime = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    if (byTime !== 0) return byTime;
    return a.externalId.localeCompare(b.externalId);
  })[0];
}
